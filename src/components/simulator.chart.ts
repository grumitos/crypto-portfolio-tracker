import type { ChartDataset } from 'chart.js';
import { getChartColors } from '../utils/theme';

let chartJsRegistered = false;

export async function destroyProjectionChart(
  canvas: HTMLCanvasElement | null,
  isJsdom: boolean,
): Promise<void> {
  if (!canvas || isJsdom) return;

  try {
    const { Chart } = await import('chart.js');
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
      existingChart.destroy();
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Simulator] chart cleanup failed:', err);
  }
}

export async function renderProjectionChart(
  canvas: HTMLCanvasElement | null,
  rows: { month: number; date: string; balance: number }[],
  targets: { be: number; goal: number },
  isJsdom: boolean,
): Promise<void> {
  if (!canvas || isJsdom) return;

  try {
    const context = canvas.getContext('2d');
    if (!context) return;

    const { Chart, registerables } = await import('chart.js');
    if (!chartJsRegistered) {
      Chart.register(...registerables);
      chartJsRegistered = true;
    }

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const cc = getChartColors();
    const datasets: ChartDataset<'line', number[]>[] = [
      {
        label: 'Balance proyectado',
        data: rows.map((row) => row.balance),
        borderColor: cc.line,
        backgroundColor: cc.fill,
        fill: true,
        tension: 0.3,
        pointRadius: rows.length > 30 ? 0 : 3,
        pointBackgroundColor: cc.pointBg,
        borderWidth: 1.5,
      },
    ];

    if (targets.be > 0) {
      datasets.push({
        label: 'BE',
        data: rows.map(() => targets.be),
        borderColor: cc.beTarget,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    if (targets.goal > 0) {
      datasets.push({
        label: 'Meta',
        data: rows.map(() => targets.goal),
        borderColor: cc.goalTarget,
        borderDash: [8, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    new Chart(context, {
      type: 'line',
      data: {
        labels: rows.map((row) => (row.month === 0 ? 'Hoy' : `M${row.month}`)),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            labels: { color: cc.legend, font: { size: 12 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: $${(ctx.parsed?.y ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: cc.tick, font: { size: 11 }, maxTicksLimit: 20 },
            grid: { color: cc.grid },
          },
          y: {
            ticks: {
              color: cc.tick,
              font: { size: 11 },
              callback: (value) => '$' + Number(value).toLocaleString(),
            },
            grid: { color: cc.grid },
          },
        },
      },
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Simulator] Chart.js error:', err);
  }
}
