import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useRef } from "react";
import { ResizeHandle } from "../components/ResizeHandle";

// Wrapper that provides a containerRef pointing at a real DOM div
function Wrapper({
  direction = "horizontal",
  align = "end",
  scrollableChild = false,
  scrollableChildRight: _scrollableChildRight = 0,
}: {
  direction?: "horizontal" | "vertical";
  align?: "start" | "end";
  scrollableChild?: boolean;
  scrollableChildRight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ position: "relative", width: 200, height: 400 }}>
      {scrollableChild && (
        <div
          data-testid="scrollable"
          style={{ overflowY: "auto", height: 200, width: 200 }}
        />
      )}
      <ResizeHandle
        direction={direction}
        containerRef={ref as React.RefObject<HTMLElement | null>}
        onSetSize={vi.fn()}
        align={align}
      />
    </div>
  );
}

// ── Context-Sensitive Cursor on Panel Dividers ───────────────────────────────

describe("ResizeHandle — P.3 context-sensitive cursor", () => {
  it("p3-1: horizontal handle renders with cursor-col-resize by default", () => {
    render(<Wrapper direction="horizontal" />);
    const handle = screen.getByTestId("resize-handle");
    expect(handle).toHaveClass("cursor-col-resize");
    expect(handle).not.toHaveClass("cursor-default");
  });

  it("p3-2: vertical handle renders with cursor-row-resize", () => {
    render(<Wrapper direction="vertical" />);
    const handle = screen.getByTestId("resize-handle");
    expect(handle).toHaveClass("cursor-row-resize");
    expect(handle).not.toHaveClass("cursor-col-resize");
  });

  it("p3-3: cursor changes to cursor-default when pointer is over a scrollbar zone", () => {
    render(<Wrapper direction="horizontal" scrollableChild />);
    const handle = screen.getByTestId("resize-handle");
    const scrollable = screen.getByTestId("scrollable");

    // Simulate the scrollable element having overflow content and a known rect
    Object.defineProperty(scrollable, "scrollHeight", { value: 999, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 200, configurable: true });
    vi.spyOn(scrollable, "getBoundingClientRect").mockReturnValue({
      right: 200,
      left: 0,
      top: 0,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Fire pointermove with clientX inside the 6px scrollbar zone (right - 3)
    fireEvent.pointerMove(handle, { clientX: 197 });

    expect(handle).toHaveClass("cursor-default");
    expect(handle).not.toHaveClass("cursor-col-resize");
  });

  it("p3-4: cursor reverts to cursor-col-resize when pointer leaves the scrollbar zone", () => {
    render(<Wrapper direction="horizontal" scrollableChild />);
    const handle = screen.getByTestId("resize-handle");
    const scrollable = screen.getByTestId("scrollable");

    Object.defineProperty(scrollable, "scrollHeight", { value: 999, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 200, configurable: true });
    vi.spyOn(scrollable, "getBoundingClientRect").mockReturnValue({
      right: 200, left: 0, top: 0, bottom: 200,
      width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    // Enter scrollbar zone
    fireEvent.pointerMove(handle, { clientX: 197 });
    expect(handle).toHaveClass("cursor-default");

    // Move outside (pointer leave)
    fireEvent.pointerLeave(handle);
    expect(handle).toHaveClass("cursor-col-resize");
    expect(handle).not.toHaveClass("cursor-default");
  });

  it("p3-5: cursor stays col-resize when pointer moves outside scrollbar zone", () => {
    render(<Wrapper direction="horizontal" scrollableChild />);
    const handle = screen.getByTestId("resize-handle");
    const scrollable = screen.getByTestId("scrollable");

    Object.defineProperty(scrollable, "scrollHeight", { value: 999, configurable: true });
    Object.defineProperty(scrollable, "clientHeight", { value: 200, configurable: true });
    vi.spyOn(scrollable, "getBoundingClientRect").mockReturnValue({
      right: 200, left: 0, top: 0, bottom: 200,
      width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    // Move in the middle of the panel, away from scrollbar
    fireEvent.pointerMove(handle, { clientX: 100 });
    expect(handle).toHaveClass("cursor-col-resize");
    expect(handle).not.toHaveClass("cursor-default");
  });
});
