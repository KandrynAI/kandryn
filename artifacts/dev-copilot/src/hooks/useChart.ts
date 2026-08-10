import { useEffect, useRef } from "react";

/**
 * Chart.js is loaded from a CDN (not bundled) — a single <script> injected once,
 * shared across every chart on the page. `useChart` attaches a config to a
 * canvas, destroying and recreating the chart whenever the config changes so the
 * canvas is never double-bound (Chart.js throws on a reused canvas otherwise).
 */

// Minimal shape we use off the CDN global; the UMD build exposes `window.Chart`.
type ChartCtor = new (canvas: HTMLCanvasElement, config: unknown) => { destroy: () => void };

declare global {
  interface Window {
    Chart?: ChartCtor;
    __chartJsLoading?: Promise<ChartCtor>;
  }
}

const CHARTJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";

export function loadChartJs(): Promise<ChartCtor> {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (window.__chartJsLoading) return window.__chartJsLoading;
  window.__chartJsLoading = new Promise<ChartCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHARTJS_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Chart) resolve(window.Chart);
      else reject(new Error("Chart.js loaded but window.Chart is undefined"));
    };
    script.onerror = () => reject(new Error("Failed to load Chart.js from CDN"));
    document.head.appendChild(script);
  });
  return window.__chartJsLoading;
}

/**
 * Bind `config` to a canvas. Pass `null` to skip (e.g. while data is loading).
 * The returned ref goes on a <canvas>. The chart is destroyed before every
 * recreate and on unmount.
 */
export function useChart(config: unknown | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!config || !canvasRef.current) return;

    loadChartJs()
      .then((Chart) => {
        if (cancelled || !canvasRef.current) return;
        if (chartRef.current) {
          chartRef.current.destroy();
          chartRef.current = null;
        }
        chartRef.current = new Chart(canvasRef.current, config);
      })
      .catch(() => {
        /* CDN unreachable — chart just won't render; page stays usable. */
      });

    return () => {
      cancelled = true;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config]);

  return canvasRef;
}
