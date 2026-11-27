/**
 * The curved layers along the lower-right edge of the hero.
 *
 * Inline SVG rather than an image: it is three paths, it scales without a
 * second asset, and it costs no request. Decorative and inert, so it is
 * hidden from assistive technology and never sits above the copy.
 */
export default function HeroArt() {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 720 460"
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMaxYMax slice"
    >
      <path d="M268 460C268 254 434 88 640 88c28 0 55 3 80 9v363H268z" fill="#E6F3F1" />
      <path d="M392 460c0-137 111-248 248-248 28 0 55 5 80 13v235H392z" fill="#C7E4DF" />
      <path d="M516 460c0-68 55-124 124-124 28 0 54 9 75 25v99H516z" fill="#96CCC4" />
    </svg>
  );
}
