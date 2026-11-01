/** What an SVG drawn with CSS classes needs to look the same as a standalone image. */
const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight", "opacity"];

/**
 * An SVG on screen as a PNG: its classes' styles are copied inline (the image
 * does not see the page's CSS), it goes over `background` and at `scale` times
 * its size, so it stays sharp on Retina screens.
 * @param {SVGSVGElement} svg
 * @param {string} background CSS color.
 * @param {number} [scale]
 * @returns {Promise<Uint8Array>}
 */
export async function svgToPng(svg, background, scale = 2) {
  const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
  const from = svg.querySelectorAll("*");
  const to = clone.querySelectorAll("*");
  from.forEach((el, i) => {
    const style = getComputedStyle(el);
    to[i].setAttribute("style", PROPS.map((p) => `${p}:${style.getPropertyValue(p)}`).join(";"));
  });
  // The size of the drawing (viewBox), not the one on screen: the zoom does not count.
  const { width, height } = svg.viewBox.baseVal;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("no se pudo dibujar la imagen"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no se pudo crear la imagen");
    return new Uint8Array(await /** @type {Blob} */ (blob).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
