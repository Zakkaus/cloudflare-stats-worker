import { useEffect, useRef, useState } from "preact/hooks";
import { echarts } from "../../charts/echarts";
import { palette, SERIES_COLORS } from "../../charts/theme";
import { theme } from "../../state/store";

// The range's daily trend, with the comparison range overlaid. Both are indexed
// from their own start day, so the same point in each lines up regardless of
// length or weekday; the x axis is the primary range's dates.
export function ReportTrend({
  dates,
  cur,
  prev,
  prevDates,
  labelCur,
  labelPrev,
}: {
  dates: string[];
  cur: (number | null)[];
  prev: (number | null)[] | null;
  prevDates: string[];
  labelCur: string;
  labelPrev: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const [ready, setReady] = useState(false);
  const themeVal = theme.value;

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current);
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    setReady(true);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !chart.current) return;
    const p = palette();
    chart.current.setOption(
      {
        grid: { left: 48, right: 16, top: prev ? 32 : 16, bottom: 28 },
        legend: prev ? { data: [labelCur, labelPrev], textStyle: { color: p.muted }, top: 0 } : undefined,
        tooltip: {
          trigger: "axis",
          formatter: (params: any[]) => {
            const i = params[0]?.dataIndex ?? 0;
            const line = (s: any) => {
              const when = s.seriesName === labelPrev ? prevDates[i] : dates[i];
              return `${s.marker}${when ?? ""}: <b>${s.value == null ? "no data" : Number(s.value).toLocaleString()}</b>`;
            };
            return params.map(line).join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: dates,
          axisLine: { lineStyle: { color: p.grid } },
          axisLabel: { color: p.muted },
        },
        yAxis: {
          type: "value",
          minInterval: 1,
          splitLine: { lineStyle: { color: p.grid } },
          axisLabel: { color: p.muted },
        },
        series: [
          ...(prev
            ? [
                {
                  name: labelPrev,
                  type: "line",
                  symbol: "circle",
                  lineStyle: { width: 2, type: "dashed", color: SERIES_COLORS[2] },
                  itemStyle: { color: SERIES_COLORS[2] },
                  data: prev,
                },
              ]
            : []),
          {
            name: labelCur,
            type: "line",
            symbol: "circle",
            areaStyle: { opacity: 0.12 },
            lineStyle: { width: 2, color: p.accent },
            itemStyle: { color: p.accent },
            data: cur,
          },
        ],
      },
      true
    );
  }, [ready, dates, cur, prev, prevDates, labelCur, labelPrev, themeVal]);

  return <div ref={el} style="width:100%;height:260px;" />;
}
