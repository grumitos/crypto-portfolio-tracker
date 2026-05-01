from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACTS_DIR = REPO_ROOT / 'artifacts' / 'binance'
SCALP_SCRIPT_NAME = 'eth_scalp_analysis.py'
ROBUST_SCRIPT_NAME = 'eth_scalp_robust_analysis.py'
SCALP_RESULTS_NAME = 'eth_scalp_results.json'
ROBUST_RESULTS_NAME = 'eth_scalp_robust_results.json'
BRIEF_NAME = 'eth_analysis_brief.md'
BRIEF_JSON_NAME = 'eth_analysis_brief.json'
LIMA_TZ = timezone(timedelta(hours=-5), 'America/Lima')


@dataclass(frozen=True)
class MarketCandle:
    open_time: datetime
    close_time: datetime
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class FrameSignal:
    interval: str
    last_close_time: datetime
    close: float
    ema20: float
    ema50: float
    ema20_slope_pct: float
    rsi14: float
    atr14: float
    high20: float
    low20: float
    high10: float
    low10: float
    score: float
    direction: str


@dataclass(frozen=True)
class TradeDecision:
    action: str
    frames_used: str
    last_candle_text: str
    confirmation: str
    stop: str
    next_frame: str
    next_run_time: datetime


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def format_time(value: datetime) -> str:
    utc_value = value.astimezone(UTC)
    local_value = value.astimezone(LIMA_TZ)
    return f'{utc_value:%Y-%m-%d %H:%M UTC} / {local_value:%Y-%m-%d %H:%M America/Lima}'


def load_json(path: Path) -> dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(f'Missing required report: {path}')
    payload = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(payload, dict):
        raise RuntimeError(f'Unexpected JSON payload in {path}')
    return payload


def load_candles(path: Path) -> list[MarketCandle]:
    if not path.exists():
        raise FileNotFoundError(f'Missing candle CSV: {path}')

    candles: list[MarketCandle] = []
    with path.open(newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            candles.append(
                MarketCandle(
                    open_time=parse_utc(str(row['open_time_utc'])),
                    close_time=parse_utc(str(row['close_time_utc'])),
                    open=float(row['open']),
                    high=float(row['high']),
                    low=float(row['low']),
                    close=float(row['close']),
                )
            )

    if len(candles) < 60:
        raise RuntimeError(f'Not enough candles in {path}; got {len(candles)}, need at least 60')
    return candles


def ema_series(values: list[float], period: int) -> list[float]:
    if len(values) < period:
        raise ValueError(f'Need at least {period} values')

    result = [math.nan] * len(values)
    seed = fmean(values[:period])
    result[period - 1] = seed
    multiplier = 2 / (period + 1)
    previous = seed
    for index in range(period, len(values)):
        previous = (values[index] - previous) * multiplier + previous
        result[index] = previous
    return result


def rsi_last(closes: list[float], period: int = 14) -> float:
    if len(closes) <= period:
        raise ValueError(f'Need more than {period} closes')

    gains: list[float] = []
    losses: list[float] = []
    for previous, current in zip(closes, closes[1 : period + 1]):
        delta = current - previous
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))

    avg_gain = fmean(gains)
    avg_loss = fmean(losses)

    for previous, current in zip(closes[period:], closes[period + 1 :]):
        delta = current - previous
        gain = max(delta, 0.0)
        loss = max(-delta, 0.0)
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def atr_last(candles: list[MarketCandle], period: int = 14) -> float:
    ranges: list[float] = []
    for index, candle in enumerate(candles):
        previous_close = candles[index - 1].close if index > 0 else candle.close
        ranges.append(
            max(
                candle.high - candle.low,
                abs(candle.high - previous_close),
                abs(candle.low - previous_close),
            )
        )
    return fmean(ranges[-period:])


def classify_signal(score: float, close: float, ema20: float, ema50: float) -> str:
    if score >= 2.0 and close > ema20 and ema20 >= ema50 * 0.998:
        return 'bullish'
    if score <= -2.0 and close < ema20 and ema20 <= ema50 * 1.002:
        return 'bearish'
    return 'neutral'


def analyze_frame(candles: list[MarketCandle], interval: str) -> FrameSignal:
    closes = [candle.close for candle in candles]
    ema20_values = ema_series(closes, 20)
    ema50_values = ema_series(closes, 50)
    ema20 = ema20_values[-1]
    ema50 = ema50_values[-1]
    ema20_past = ema20_values[-6]
    ema20_slope_pct = ((ema20 / ema20_past) - 1) * 100 if not math.isnan(ema20_past) else 0.0
    rsi14 = rsi_last(closes)
    atr14 = atr_last(candles)
    last = candles[-1]

    score = 0.0
    score += 1.0 if last.close > ema20 else -1.0
    score += 1.0 if ema20 > ema50 else -1.0
    if ema20_slope_pct > 0.05:
        score += 1.0
    elif ema20_slope_pct < -0.05:
        score -= 1.0

    if 52 <= rsi14 <= 68:
        score += 1.0
    elif rsi14 > 68 and last.close > ema20:
        score += 0.5
    elif 32 <= rsi14 <= 48:
        score -= 1.0
    elif rsi14 < 32 and last.close < ema20:
        score -= 0.5

    score += 0.5 if last.close > last.open else -0.5
    direction = classify_signal(score, last.close, ema20, ema50)

    recent20 = candles[-20:]
    recent10 = candles[-10:]
    return FrameSignal(
        interval=interval,
        last_close_time=last.close_time,
        close=last.close,
        ema20=ema20,
        ema50=ema50,
        ema20_slope_pct=ema20_slope_pct,
        rsi14=rsi14,
        atr14=atr14,
        high20=max(candle.high for candle in recent20),
        low20=min(candle.low for candle in recent20),
        high10=max(candle.high for candle in recent10),
        low10=min(candle.low for candle in recent10),
        score=score,
        direction=direction,
    )


def interval_delta(interval: str) -> timedelta:
    if interval == '1h':
        return timedelta(hours=1)
    if interval == '4h':
        return timedelta(hours=4)
    raise ValueError(f'Unsupported interval for rerun cadence: {interval}')


def build_decision(h1: FrameSignal, h4: FrameSignal, robust_frames: list[str]) -> TradeDecision:
    if h1.direction == 'bullish' and h4.direction == 'bullish':
        action = 'LONG'
    elif h1.direction == 'bearish' and h4.direction == 'bearish':
        action = 'SHORT'
    else:
        action = 'WAIT'

    long_trigger = max(h1.high20, h1.ema20)
    short_trigger = min(h1.low20, h1.ema20)
    long_stop = min(h1.low20, h4.low10) - (h1.atr14 * 0.15)
    short_stop = max(h1.high20, h4.high10) + (h1.atr14 * 0.15)

    if action == 'LONG':
        confirmation = f'alineado; sostener cierre 1h sobre {h1.ema20:.2f}'
        stop = f'invalidar/stop orientativo bajo {long_stop:.2f}'
        next_frame = '1h'
    elif action == 'SHORT':
        confirmation = f'alineado; sostener cierre 1h bajo {h1.ema20:.2f}'
        stop = f'invalidar/stop orientativo sobre {short_stop:.2f}'
        next_frame = '1h'
    else:
        stop = f'si confirma long, stop bajo {long_stop:.2f}; si confirma short, stop sobre {short_stop:.2f}'
        if h1.direction == 'bullish' and h4.direction != 'bullish':
            confirmation = f'pendiente cierre 4h bullish sobre EMA20 {h4.ema20:.2f}'
            next_frame = '4h'
        elif h1.direction == 'bearish' and h4.direction != 'bearish':
            confirmation = f'pendiente cierre 4h bearish bajo EMA20 {h4.ema20:.2f}'
            next_frame = '4h'
        elif h4.direction == 'bullish':
            confirmation = f'pendiente cierre 1h sobre {long_trigger:.2f}'
            next_frame = '1h'
        elif h4.direction == 'bearish':
            confirmation = f'pendiente cierre 1h bajo {short_trigger:.2f}'
            next_frame = '1h'
        else:
            confirmation = f'pendiente ruptura 1h fuera de {h1.low20:.2f}-{h1.high20:.2f}'
            next_frame = '1h'

    frame_for_next_run = h4 if next_frame == '4h' else h1
    next_close = frame_for_next_run.last_close_time + interval_delta(next_frame)
    next_run_time = next_close + timedelta(minutes=1, milliseconds=1)
    robust_text = ', '.join(robust_frames) if robust_frames else 'sin robustez disponible'

    return TradeDecision(
        action=action,
        frames_used=f'1h gatillo, 4h confirmacion; robustez: {robust_text}',
        last_candle_text=f'1h {format_time(h1.last_close_time)}; 4h {format_time(h4.last_close_time)}',
        confirmation=confirmation,
        stop=stop,
        next_frame=next_frame,
        next_run_time=next_run_time,
    )


def render_brief(
    generated_at: datetime,
    decision: TradeDecision,
    h1: FrameSignal,
    h4: FrameSignal,
    scalp_payload: dict[str, object],
) -> str:
    live_price = scalp_payload.get('live_price')
    live_price_text = f'{float(live_price):.2f}' if isinstance(live_price, int | float) else 'n/a'

    return '\n'.join(
        [
            '# ETHUSDT unified brief',
            '',
            f'- Generado: `{format_time(generated_at)}`',
            f'- Decision: `{decision.action}`',
            f'- Marcos usados: `{decision.frames_used}`',
            f'- Ultima vela cerrada: `{decision.last_candle_text}`',
            f'- Confirmacion: {decision.confirmation}',
            f'- Invalidacion/stop: {decision.stop}',
            f'- Proxima re-ejecucion: `{format_time(decision.next_run_time)}` despues del cierre `{decision.next_frame}`',
            f'- Precio snapshot: `{live_price_text}` USDT; 1h `{h1.direction}` RSI `{h1.rsi14:.1f}`; 4h `{h4.direction}` RSI `{h4.rsi14:.1f}`',
            '',
        ]
    )


def run_script(script_path: Path) -> None:
    if not script_path.exists():
        raise FileNotFoundError(f'Missing Binance script: {script_path}')

    completed = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    output = completed.stdout.strip()
    if output:
        print(output)


def robust_intervals(payload: dict[str, object]) -> list[str]:
    intervals = payload.get('intervals')
    if not isinstance(intervals, dict):
        return []
    return [str(key) for key in intervals.keys()]


def write_unified_outputs(artifacts_dir: Path) -> tuple[Path, Path, TradeDecision]:
    scalp_payload = load_json(artifacts_dir / SCALP_RESULTS_NAME)
    robust_payload = load_json(artifacts_dir / ROBUST_RESULTS_NAME)
    h1 = analyze_frame(load_candles(artifacts_dir / 'ethusdt_1h_last30d.csv'), '1h')
    h4 = analyze_frame(load_candles(artifacts_dir / 'ethusdt_4h_last30d.csv'), '4h')

    generated_value = scalp_payload.get('generated_at_utc')
    generated_at = parse_utc(str(generated_value)) if generated_value else datetime.now(tz=UTC)
    decision = build_decision(h1, h4, robust_intervals(robust_payload))
    brief = render_brief(generated_at, decision, h1, h4, scalp_payload)

    brief_path = artifacts_dir / BRIEF_NAME
    brief_json_path = artifacts_dir / BRIEF_JSON_NAME
    brief_path.write_text(brief, encoding='utf-8')
    brief_json_path.write_text(
        json.dumps(
            {
                'generated_at_utc': generated_at.isoformat(),
                'decision': asdict(decision),
                'frames': {
                    '1h': asdict(h1),
                    '4h': asdict(h4),
                },
            },
            indent=2,
            default=str,
        ),
        encoding='utf-8',
    )
    return brief_path, brief_json_path, decision


def run(refresh: bool, artifacts_dir: Path) -> tuple[Path, Path, TradeDecision]:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    if refresh:
        run_script(artifacts_dir / SCALP_SCRIPT_NAME)
        run_script(artifacts_dir / ROBUST_SCRIPT_NAME)
    return write_unified_outputs(artifacts_dir)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Refresh ETHUSDT Binance artifacts and build one short decision brief.'
    )
    parser.add_argument(
        '--skip-refresh',
        action='store_true',
        help='Build only the unified brief from existing JSON/CSV artifacts.',
    )
    parser.add_argument(
        '--artifacts-dir',
        type=Path,
        default=DEFAULT_ARTIFACTS_DIR,
        help='Directory containing artifacts/binance scripts and reports.',
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        brief_path, brief_json_path, decision = run(
            refresh=not args.skip_refresh,
            artifacts_dir=args.artifacts_dir.resolve(),
        )
    except Exception as exc:
        print(f'ETH analysis failed: {exc}', file=sys.stderr)
        return 1

    print(brief_path)
    print(brief_json_path)
    print(f'Decision: {decision.action}')
    print(f'Next run: {format_time(decision.next_run_time)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
