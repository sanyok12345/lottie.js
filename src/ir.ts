import type { Matrix } from './math/matrix.js';

export type Point = number[];

export interface PathData {
  c?: boolean;
  v: Point[];
  i: Point[];
  o: Point[];
}

export interface GradientStop {
  p: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorPaint {
  kind: 'color';
  color: number[];
  alpha: number;
  rule?: number;
  width?: number;
  cap?: number;
  join?: number;
}

export interface GradientPaint {
  kind: 'linear' | 'radial';
  s: number[];
  e: number[];
  stops: GradientStop[];
  alpha: number;
  rule?: number;
}

export type FillPaint = ColorPaint | GradientPaint;

export interface DrawOp {
  paths: PathData[];
  matrix: Matrix;
  fills: FillPaint[];
  strokes: ColorPaint[];
  static?: boolean;
}

export interface Scene {
  width: number;
  height: number;
  ops: DrawOp[];
}
