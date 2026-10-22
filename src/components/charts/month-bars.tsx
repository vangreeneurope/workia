export type MonthBar = { label: string; value: number; display: string };

/**
 * Barras verticales por mes, una sola serie (sin leyenda: el título la nombra).
 * Cada barra lleva su valor en <title> y la tabla equivalente queda disponible
 * para lectores de pantalla.
 */
export function MonthBars({ data, caption }: { data: MonthBar[]; caption: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 320;
  const height = 120;
  const gap = 4;
  const barWidth = (width - gap * (data.length - 1)) / data.length;
  const peakValue = Math.max(0, ...data.map((d) => d.value));
  const peak = data.find((d) => d.value === peakValue && d.value > 0);
  return (
    <figure className="grid gap-2">
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label={caption}
      >
        <line x1={0} x2={width} y1={height} y2={height} strokeWidth={1} className="stroke-border" />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(4, (d.value / max) * (height - 16)) : 0;
          const x = i * (barWidth + gap);
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${d.display}`}</title>
              <rect x={x} y={0} width={barWidth} height={height} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${height} v${-(h - 4)} q0,-4 4,-4 h${barWidth - 8} q4,0 4,4 v${h - 4} z`}
                  className="fill-chart-1"
                />
              ) : null}
              {d === peak ? (
                <text
                  x={x + barWidth / 2}
                  y={height - h - 4}
                  textAnchor="middle"
                  className="fill-foreground text-[10px] font-medium"
                >
                  {d.display}
                </text>
              ) : null}
              <text
                x={x + barWidth / 2}
                y={height + 13}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {d.label.slice(0, 1).toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
