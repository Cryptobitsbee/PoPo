import { useCallback, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * PageShell — standard page frame with a non-scrolling heading zone.
 *
 * Why this exists
 * ───────────────
 * AppShell's content container is `overflow: auto`, so by default a whole
 * page scrolls as one block and its `<h1>` slides out of view. HistoryPage
 * had already solved this locally by being exactly `height: 100%` and
 * splitting itself into a `flexShrink: 0` header plus a
 * `flex: 1 / overflowY: auto` body, which keeps the heading planted while
 * only the list moves.
 *
 * That pattern was correct but copy-pasted per page waiting to happen, and
 * every page that had not adopted it scrolled its own title away. This
 * component is that same structure, named once.
 *
 * It is deliberately NOT `position: sticky`. Sticky would keep the heading
 * visible but the content would slide *underneath* it, requiring an opaque
 * background and a z-index on every page, and any translucent surface
 * scrolling past would show through. Owning the scroll container instead
 * means the body physically cannot overlap the header, so no stacking or
 * background tricks are needed.
 *
 * The scroll container is exposed via `bodyRef` for pages that need to
 * observe or drive it (HistoryPage tracks the current date section).
 */

export interface PageShellProps {
  /** Heading zone. Stays put while `children` scrolls. */
  header: ReactNode;
  /** Scrollable page body. */
  children: ReactNode;
  /** Ref onto the scrolling element, for scroll-position observers. */
  bodyRef?: React.Ref<HTMLDivElement>;
  /** Max content width. Defaults to the 1040px app measure. */
  maxWidth?: number;
  /** Extra style for the scrolling body (e.g. bottom padding). */
  bodyStyle?: CSSProperties;
}

export default function PageShell({
  header,
  children,
  bodyRef,
  maxWidth = 1040,
  bodyStyle,
}: PageShellProps) {
  // Whether the body has been scrolled away from the top.
  //
  // The top-edge fade must only exist while content is actually passing
  // under the header. Applying it unconditionally faded whatever happened
  // to sit at the top of the page even at rest — it sliced the Dictionary
  // search field in half, because that field is the first thing in the
  // scroll body rather than part of the header.
  const [scrolled, setScrolled] = useState(false);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // 2px of slack: sub-pixel scroll positions and trackpad rubber-banding
    // otherwise flicker the mask on and off at the very top.
    const next = e.currentTarget.scrollTop > 2;
    setScrolled((prev) => (prev === next ? prev : next));
  }, []);

  const fade =
    "linear-gradient(to bottom, transparent 0, #000 16px, #000 100%)";

  return (
    <div
      style={{
        height: "100%",
        maxWidth,
        margin: "0 auto",
        // Horizontal padding lives here so the header and body share the
        // same measure. Vertical padding is split: top on the header,
        // bottom on the body, so scrolled content clears the window edge.
        padding: "var(--sp-8) var(--sp-10) 0",
        display: "flex",
        flexDirection: "column",
        // Without this a flex child refuses to shrink below its content
        // height and the inner overflow never engages.
        minHeight: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          paddingRight: "var(--sp-6)",
          // Breathing room between the planted heading and the content
          // that scrolls beneath it. Without this the body's top edge is
          // flush against the header and scrolled content appears to
          // collide with the title.
          paddingBottom: "var(--sp-5)",
        }}
      >
        {header}
      </div>

      <div
        ref={bodyRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "var(--sp-10)",
          // Soft top edge, ONLY while scrolled.
          //
          // A flex layout means content cannot physically overlap the
          // header, but it was still cut off by a hard horizontal line at
          // the scroll boundary, which reads as content colliding with the
          // heading. This fades the first 16px so rows dissolve as they
          // leave instead of being sliced.
          //
          // Gated on `scrolled` because at rest the fade has nothing to
          // soften and just dims whatever sits at the top of the page — it
          // was visibly halving the Dictionary search field, which lives
          // in the scroll body rather than the header.
          maskImage: scrolled ? fade : undefined,
          WebkitMaskImage: scrolled ? fade : undefined,
          // Scrollbar gutter.
          //
          // The scroll container is the BODY, so the scrollbar renders at
          // the body's right edge — which, with horizontal padding on the
          // outer wrapper, put it flush against the cards. The bar was
          // visually touching component borders on every scrollable page.
          //
          // Negative margin lets the body bleed back out into the
          // wrapper's right padding so the bar sits nearer the window
          // edge, while the matching padding holds content clear of it.
          // Content stays aligned with the header because the two offsets
          // cancel exactly.
          marginRight: "calc(-1 * var(--sp-6))",
          paddingRight: "var(--sp-6)",
          // Reserve the bar's width at all times so content does not
          // shift sideways when a short page becomes a long one.
          scrollbarGutter: "stable",
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
