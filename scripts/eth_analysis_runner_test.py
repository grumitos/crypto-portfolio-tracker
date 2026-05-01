from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

import eth_analysis_runner as runner  # noqa: E402


def build_candles(start: float, step: float, count: int, start_time: datetime) -> list[runner.MarketCandle]:
    candles: list[runner.MarketCandle] = []
    for index in range(count):
        open_price = start + (step * index)
        close_price = open_price + step * 0.7
        high = max(open_price, close_price) + abs(step) * 0.8 + 1
        low = min(open_price, close_price) - abs(step) * 0.8 - 1
        open_time = start_time + timedelta(hours=index)
        candles.append(
            runner.MarketCandle(
                open_time=open_time,
                close_time=open_time + timedelta(hours=1) - timedelta(milliseconds=1),
                open=open_price,
                high=high,
                low=low,
                close=close_price,
            )
        )
    return candles


class EthAnalysisRunnerTest(unittest.TestCase):
    def test_build_decision_returns_long_when_1h_and_4h_are_bullish(self) -> None:
        start_time = datetime(2026, 4, 1, tzinfo=UTC)
        h1 = runner.analyze_frame(build_candles(2000, 2.5, 80, start_time), '1h')
        h4 = runner.analyze_frame(build_candles(1980, 3.0, 80, start_time), '4h')

        decision = runner.build_decision(h1, h4, ['1h', '4h'])

        self.assertEqual(decision.action, 'LONG')
        self.assertEqual(decision.next_frame, '1h')
        self.assertIn('sostener cierre 1h', decision.confirmation)

    def test_build_decision_waits_for_4h_when_only_1h_is_bullish(self) -> None:
        start_time = datetime(2026, 4, 1, tzinfo=UTC)
        h1 = runner.analyze_frame(build_candles(2000, 2.5, 80, start_time), '1h')
        h4 = runner.analyze_frame(build_candles(2150, -1.5, 80, start_time), '4h')

        decision = runner.build_decision(h1, h4, ['1h', '4h'])

        self.assertEqual(decision.action, 'WAIT')
        self.assertEqual(decision.next_frame, '4h')
        self.assertIn('pendiente cierre 4h', decision.confirmation)

    def test_next_run_is_one_minute_after_next_selected_candle_close(self) -> None:
        start_time = datetime(2026, 4, 1, tzinfo=UTC)
        h1 = runner.analyze_frame(build_candles(2000, 2.5, 80, start_time), '1h')
        h4 = runner.analyze_frame(build_candles(2150, -1.5, 80, start_time), '4h')

        decision = runner.build_decision(h1, h4, ['1h', '4h'])

        expected = h4.last_close_time + timedelta(hours=4, minutes=1, milliseconds=1)
        self.assertEqual(decision.next_run_time, expected)


if __name__ == '__main__':
    unittest.main()
