import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/**
 * Renders a Code128 barcode for a tracking number.
 * Compact, scannable on phones, and the digits are printed beneath
 * (jsbarcode's built-in `displayValue`). Use a small height so it fits
 * comfortably inside cards.
 */
export default function Barcode({
  value,
  height = 40,
  width = 1.6,
  fontSize = 11,
  margin = 0,
  background = "transparent",
  lineColor = "#e5e5e5",
  testId,
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format: "CODE128",
        height,
        width,
        fontSize,
        margin,
        background,
        lineColor,
        displayValue: true,
        font: "monospace",
        textMargin: 2,
      });
    } catch {
      // Invalid input — silently no-op.
    }
  }, [value, height, width, fontSize, margin, background, lineColor]);

  if (!value) return null;
  return <svg ref={ref} data-testid={testId || `barcode-${value}`} aria-label={`Tracking ${value}`} />;
}
