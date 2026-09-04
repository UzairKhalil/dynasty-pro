const TURBULENCE = (
  <>
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed="11" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.9" xChannelSelector="R" yChannelSelector="G" />
  </>
);

/**
 * The filters every hand-drawn stroke in the app runs through. Mounted once at
 * the root and referenced by url(#…) from marks, grid, strike and tallies.
 *
 * There are two because SVG filter regions default to objectBoundingBox units.
 * That is fine for a shape with area, but a filter region is a PERCENTAGE OF
 * THE BOUNDING BOX — so a perfectly horizontal line, whose bbox height is
 * zero, gets a zero-height filter region and paints NOTHING AT ALL. The
 * winning strike is exactly that shape on every row and column win: six of the
 * eight winning lines on a 3x3 board. It silently vanished.
 *
 * `#chalk-line` therefore uses userSpaceOnUse with a region covering the
 * board's 0..100 viewBox, which is independent of the shape's bbox. Use it for
 * anything straight. `#chalk` stays on bbox units for shapes with real area —
 * marks, seat marks, tallies — which are drawn at several different user-space
 * scales and so can't share one fixed region.
 */
export default function ChalkDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="chalk" x="-15%" y="-15%" width="130%" height="130%"
              colorInterpolationFilters="sRGB">
        {TURBULENCE}
      </filter>

      <filter id="chalk-line" filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"
              colorInterpolationFilters="sRGB">
        {TURBULENCE}
      </filter>
    </svg>
  );
}
