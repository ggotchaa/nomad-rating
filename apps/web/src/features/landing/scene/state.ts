// Scene state written by the scroll timeline and read by the render loop. Kept apart from
// HoloScene so the page can build the scroll story before three.js is loaded.

export type SceneState = {
  /** 0 paddle · 1 galaxy · 2 rating chart · 3 hall plan (fractions morph). */
  shape: number
  particles: number
  paddleOpacity: number
  paddleX: number
  paddleY: number
  paddleZ: number
  paddleRotX: number
  paddleRotY: number
  paddleRotZ: number
  paddleScale: number
  ballX: number
  ballY: number
  ballZ: number
  ballOpacity: number
  /** Weights of the ball modes (juggling on the paddle, orbit, riding the chart, bouncing on table 5). */
  ballBounce: number
  ballOrbit: number
  ballCurve: number
  curveT: number
  ballTable: number
  camX: number
  camY: number
  camZ: number
  beam: number
  hiCall: number
  hiBook: number
  swarmRotY: number
}

export const INITIAL_STATE: SceneState = {
  shape: 0,
  particles: 1,
  paddleOpacity: 1,
  paddleX: 0.9,
  paddleY: -0.35,
  paddleZ: 0,
  paddleRotX: -0.62,
  paddleRotY: -0.35,
  paddleRotZ: -0.3,
  paddleScale: 1,
  ballX: 0,
  ballY: 0,
  ballZ: 0,
  ballOpacity: 1,
  ballBounce: 1,
  ballOrbit: 0,
  ballCurve: 0,
  curveT: 0,
  ballTable: 0,
  camX: 0,
  camY: 0.1,
  camZ: 7.2,
  beam: 1,
  hiCall: 0,
  hiBook: 0,
  swarmRotY: 0,
}
