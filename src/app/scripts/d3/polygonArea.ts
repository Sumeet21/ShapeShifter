export function polygonArea(polygon: ReadonlyArray<[number, number]>) {
  let area = 0;
  let a: [number, number];
  let b = polygon[polygon.length - 1];
  let i = -1;
  while (++i < polygon.length) {
    a = b;
    b = polygon[i];
    area += a[1] * b[0] - a[0] * b[1];
  }
  return area / 2;
}
