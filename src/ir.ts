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
}

export interface GradientPaint {
  kind: 'linear' | 'radial';
  s: number[];
  e: number[];
  h?: number;
  a?: number;
  stops: GradientStop[];
  alpha: number;
  rule?: number;
}

export type FillPaint = ColorPaint | GradientPaint;

export interface StrokeProps {
  width: number;
  cap: number;
  join: number;
  miter?: number;
  dash?: number[];
  dashOffset?: number;
}

export type StrokePaint = FillPaint & StrokeProps;

export interface ClipShape {
  paths: PathData[];
  matrix: Matrix;
  rule?: number;
}

export interface Clip {
  shapes: ClipShape[];
  mode: 1 | 2 | 3;
  alpha?: number;
}

interface BaseOp {
  matrix: Matrix;
  clips?: Clip[];
  blend?: number;
  static?: boolean;
}

export interface ShapeOp extends BaseOp {
  kind: 'shape';
  paths: PathData[];
  fills: FillPaint[];
  strokes: StrokePaint[];
}

export interface ImageOp extends BaseOp {
  kind: 'image';
  src: string;
  assetId?: string;
  width: number;
  height: number;
  alpha: number;
  paths?: PathData[];
  fills?: FillPaint[];
  strokes?: StrokePaint[];
}

export type DrawOp = ShapeOp | ImageOp;

export interface Scene {
  width: number;
  height: number;
  ops: DrawOp[];
}
