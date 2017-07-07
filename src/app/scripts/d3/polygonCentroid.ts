import { Point, Polygon } from './types';

export function polygonCentroid(polygon: Polygon): Point {
  let i = -1;
  let x = 0;
  let y = 0;
  let a: Point;
  let b = polygon[polygon.length - 1];
  let c: number;
  let k = 0;
  while (++i < polygon.length) {
    a = b;
    b = polygon[i];
    k += c = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * c;
    y += (a[1] + b[1]) * c;
  }
  return (k *= 3), [x / k, y / k];
}
