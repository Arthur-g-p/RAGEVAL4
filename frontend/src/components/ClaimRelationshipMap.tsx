import React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { logger } from '../utils/logger';

// Local copy of the ClaimStatus union used in QuestionInspector
// (structural type match; no runtime dependency)
type ClaimStatus = 'entailed' | 'neutral' | 'contradiction';

interface ClaimRelationshipMapProps {
  gtClaims: string[];
  respClaims: string[];
  gtStatuses: ClaimStatus[]; // per-GT-claim relation to the response (response2answer)
  respStatuses: ClaimStatus[]; // per-response-claim relation to the GT (answer2response)
}

interface ConnectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  side: 'gt' | 'resp';
  idx: number;
  label: string;
}

const statusColors = (status: ClaimStatus) => {
  switch (status) {
    case 'entailed':
      return { fill: 'rgba(16,185,129,0.22)', stroke: '#10b981' }; // emerald
    case 'contradiction':
      return { fill: 'rgba(239,68,68,0.20)', stroke: '#ef4444' }; // red
    case 'neutral':
    default:
      return { fill: 'rgba(156,163,175,0.18)', stroke: '#9ca3af' }; // gray
  }
};

const pillClass = (status: ClaimStatus) => {
  const base = 'whitespace-pre-wrap rounded-md px-3 py-2 border';
  if (status === 'entailed') return `${base} bg-green-50 border-green-200 text-green-700`;
  if (status === 'contradiction') return `${base} bg-red-50 border-red-200 text-red-700`;
  return `${base} bg-gray-50 border-gray-200 text-gray-700`;
};

const ClaimRelationshipMap: React.FC<ClaimRelationshipMapProps> = ({ gtClaims, respClaims, gtStatuses, respStatuses }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const rightColRef = useRef<HTMLDivElement | null>(null);

  const leftItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const rightItemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [svgSize, setSvgSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [bridgeX, setBridgeX] = useState<{ leftEdge: number; rightEdge: number }>({ leftEdge: 0, rightEdge: 0 });
  const [connectors, setConnectors] = useState<ConnectorRect[]>([]);

  // Clean refs array sizes on claim length change
  useEffect(() => {
    leftItemRefs.current = new Array(gtClaims.length).fill(null);
  }, [gtClaims.length]);
  useEffect(() => {
    rightItemRefs.current = new Array(respClaims.length).fill(null);
  }, [respClaims.length]);

  const computeLayout = React.useCallback(() => {
    const container = containerRef.current;
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!container || !leftCol || !rightCol) return;

    const cRect = container.getBoundingClientRect();
    const lRect = leftCol.getBoundingClientRect();
    const rRect = rightCol.getBoundingClientRect();

    const leftEdge = lRect.right - cRect.left;
    const rightEdge = rRect.left - cRect.left;

    const conns: ConnectorRect[] = [];

    // Left-side (GT) bridges into the gap
    leftItemRefs.current.forEach((el, i) => {
      if (!el) return;
      const eRect = el.getBoundingClientRect();
      const y = eRect.top - cRect.top;
      const h = eRect.height;
      const status = (gtStatuses[i] ?? 'neutral') as ClaimStatus;
      const { fill, stroke } = statusColors(status);
      conns.push({
        x: leftEdge,
        y: y + Math.max(2, h * 0.25),
        width: Math.max(6, rightEdge - leftEdge),
        height: Math.max(8, Math.min(18, h * 0.5)),
        fill,
        stroke,
        side: 'gt',
        idx: i,
        label: `GT[${i}] → Response :: ${status}`,
      });
    });

    // Right-side (Response) bridges back across the gap (slightly offset to avoid perfect overlap)
    rightItemRefs.current.forEach((el, i) => {
      if (!el) return;
      const eRect = el.getBoundingClientRect();
      const y = eRect.top - cRect.top;
      const h = eRect.height;
      const status = (respStatuses[i] ?? 'neutral') as ClaimStatus;
      const { fill, stroke } = statusColors(status);
      conns.push({
        x: leftEdge,
        y: y + Math.max(2, h * 0.25) + 2, // small offset
        width: Math.max(6, rightEdge - leftEdge),
        height: Math.max(6, Math.min(14, h * 0.4)),
        fill,
        stroke,
        side: 'resp',
        idx: i,
        label: `Response[${i}] → GT :: ${status}`,
      });
    });

    setSvgSize({ width: cRect.width, height: cRect.height });
    setBridgeX({ leftEdge, rightEdge });
    setConnectors(conns);

    // Debug logs for feedback
    logger.info(`ClaimRelationshipMap layout computed: container(${Math.round(cRect.width)}x${Math.round(cRect.height)}), gap=${Math.round(rightEdge - leftEdge)}`);
    try {
      // eslint-disable-next-line no-console
      console.table(conns.map((c) => ({ side: c.side, idx: c.idx, y: Math.round(c.y), h: Math.round(c.height), label: c.label })));
    } catch {}
  }, [gtStatuses, respStatuses]);

  // Initial and on dependency change
  useLayoutEffect(() => {
    computeLayout();
  }, [computeLayout, gtClaims.length, respClaims.length]);

  // Resize handling
  useEffect(() => {
    const handle = () => computeLayout();
    window.addEventListener('resize', handle);
    let ro: ResizeObserver | null = null;
    try {
      // @ts-ignore - in some TS configs, lib.dom may not include ResizeObserver types
      if (typeof ResizeObserver !== 'undefined') {
        // @ts-ignore
        ro = new ResizeObserver(() => computeLayout());
        if (containerRef.current) ro.observe(containerRef.current);
        if (leftColRef.current) ro.observe(leftColRef.current);
        if (rightColRef.current) ro.observe(rightColRef.current);
      }
    } catch {}
    return () => {
      window.removeEventListener('resize', handle);
      if (ro) {
        try { ro.disconnect(); } catch {}
      }
    };
  }, [computeLayout]);

  const hasData = (gtClaims?.length ?? 0) > 0 || (respClaims?.length ?? 0) > 0;

  return (
    <div ref={containerRef} className="relative" style={{ position: 'relative' }}>
      {!hasData ? (
        <div className="text-sm text-gray-500">No claims available to relate.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem' }}>
            <div ref={leftColRef}>
              <div className="text-sm font-semibold text-gray-900 mb-2">Ground Truth Claims ({gtClaims.length})</div>
              <ul className="list-none space-y-2">
                {gtClaims.map((c, i) => {
                  const status = (gtStatuses[i] ?? 'neutral') as ClaimStatus;
                  return (
                    <li
                      key={`gt-${i}`}
                      ref={(el) => { leftItemRefs.current[i] = el; }}
                      className={pillClass(status)}
                      title={`GT claim ${i + 1} is ${status} by the response as a whole`}
                    >
                      {String(c || '')}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div ref={rightColRef}>
              <div className="text-sm font-semibold text-gray-900 mb-2">Response Claims ({respClaims.length})</div>
              <ul className="list-none space-y-2">
                {respClaims.map((c, i) => {
                  const status = (respStatuses[i] ?? 'neutral') as ClaimStatus;
                  return (
                    <li
                      key={`resp-${i}`}
                      ref={(el) => { rightItemRefs.current[i] = el; }}
                      className={pillClass(status)}
                      title={`Response claim ${i + 1} is ${status} by the ground truth as a whole`}
                    >
                      {String(c || '')}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* SVG overlay that draws rectangular bridges across the gap */}
          <svg
            width={svgSize.width}
            height={svgSize.height}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            aria-hidden="true"
          >
            {/* Visualize the gap edges for debugging; comment out if too noisy */}
            {/* <line x1={bridgeX.leftEdge} y1={0} x2={bridgeX.leftEdge} y2={svgSize.height} stroke="#e5e7eb" strokeDasharray="4 4" />
            <line x1={bridgeX.rightEdge} y1={0} x2={bridgeX.rightEdge} y2={svgSize.height} stroke="#e5e7eb" strokeDasharray="4 4" /> */}

            {connectors.map((c, idx) => (
              <g key={`conn-${c.side}-${c.idx}-${idx}`}>                
                <rect x={c.x} y={c.y} width={c.width} height={c.height} fill={c.fill} stroke={c.stroke} rx={4} ry={4} />
              </g>
            ))}
          </svg>
        </>
      )}
    </div>
  );
};

export default ClaimRelationshipMap;

