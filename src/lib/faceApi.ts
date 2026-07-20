import type * as FaceApiModule from "@vladmandic/face-api";

const MODEL_URL = "/models";

let faceapiPromise: Promise<typeof FaceApiModule> | null = null;

// Loaded dynamically, client-side only. @vladmandic/face-api (via its tfjs
// backend) evaluates browser-only globals at module scope, which breaks
// Next.js's server-side prerender of pages that import it — deferring the
// import to first use keeps it out of any server bundle path.
function getFaceApi(): Promise<typeof FaceApiModule> {
  if (!faceapiPromise) {
    faceapiPromise = import("@vladmandic/face-api");
  }
  return faceapiPromise;
}

let modelsLoaded: Promise<void> | null = null;

/**
 * Loads the SSD Mobilenet detector, 68-point landmark net, and the 128-d
 * face recognition net from /public/models. Safe to call repeatedly —
 * the underlying load only happens once.
 */
export function loadFaceModels(): Promise<void> {
  if (!modelsLoaded) {
    modelsLoaded = getFaceApi()
      .then((faceapi) =>
        Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ])
      )
      .then(() => undefined);
  }
  return modelsLoaded;
}

export async function detectSingleFaceDescriptor(
  input: HTMLVideoElement
): Promise<Float32Array | null> {
  const faceapi = await getFaceApi();
  const result = await faceapi
    .detectSingleFace(input)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result ? result.descriptor : null;
}
