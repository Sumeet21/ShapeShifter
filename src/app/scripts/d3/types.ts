export type Point = [number, number];
export type Triangle = [Point, Point, Point];
export type Polygon = ReadonlyArray<Point>;
export interface Geometry {
  readonly type: 'Polygon';
  readonly area: number;
  readonly arcs: [ReadonlyArray<number>];
}
