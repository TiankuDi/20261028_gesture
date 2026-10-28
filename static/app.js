import { FilesetResolver, GestureRecognizer } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";

const video = document.querySelector("#camera");
const cameraButton = document.querySelector("#camera-button");
const cameraStage = document.querySelector("#camera-stage");
const placeholder = document.querySelector("#camera-placeholder");
const stageChip = document.querySelector("#stage-chip");
const gestureLabel = document.querySelector("#gesture-label");
const gestureDetail = document.querySelector("#gesture-detail");
const notice = document.querySelector("#notice");

const gallery = [
  { file: "aurora.svg", alt: "北方極光與山巒的插畫", title: "極光之境", description: "夜色與流動的光", kicker: "COLLECTION 01" },
  { file: "desert.svg", alt: "夕陽下的沙漠與抽象拱門", title: "沙丘漫遊", description: "日落時分的遠方", kicker: "COLLECTION 02" },
  { file: "ocean.svg", alt: "海面與海浪的藍色插畫", title: "深藍潮汐", description: "海風帶來的寧靜", kicker: "COLLECTION 03" },
  { file: "garden.svg", alt: "花園裡的植物與晨光", title: "晨光花園", description: "在綠意裡慢下來", kicker: "COLLECTION 04" },
];

const galleryImage = document.querySelector("#gallery-image");
const galleryCount = document.querySelector("#gallery-count");
const imageIndex = document.querySelector("#image-index");
const imageKicker = document.querySelector("#image-kicker");
const imageTitle = document.querySelector("#image-title");
const imageDescription = document.querySelector("#image-description");
const galleryImageWrap = document.querySelector(".gallery-image-wrap");
const imageFlipStatus = document.querySelector("#image-flip-status");
let currentIndex = 0;
let imageFlipped = false;
let imageVerticallyFlipped = false;
let imageColorsInverted = false;

let stream;
let recognizer;
let running = false;
let lastVideoTime = -1;
let lastPalmX = null;
let lastActionAt = 0;
let latchedFingerGesture = null;
const movementThreshold = 0.14;
const actionCooldownMs = 850;
const handFacingStates = new Map();

function showImage(index) {
  currentIndex = (index + gallery.length) % gallery.length;
  const image = gallery[currentIndex];
  galleryImage.src = `/static/images/${image.file}`;
  galleryImage.alt = image.alt;
  galleryCount.textContent = `${String(currentIndex + 1).padStart(2, "0")} / ${String(gallery.length).padStart(2, "0")}`;
  imageIndex.textContent = String(currentIndex + 1).padStart(2, "0");
  imageKicker.textContent = image.kicker;
  imageTitle.textContent = image.title;
  imageDescription.textContent = image.description;
}

function renderImageOrientation() {
  galleryImageWrap.classList.toggle("is-flipped", imageFlipped);
  galleryImageWrap.classList.toggle("is-vertically-flipped", imageVerticallyFlipped);
  galleryImageWrap.classList.toggle("is-colors-inverted", imageColorsInverted);
  const effects = [];
  if (imageFlipped) effects.push("左右鏡像");
  if (imageVerticallyFlipped) effects.push("上下翻轉");
  if (imageColorsInverted) effects.push("色彩反相");
  imageFlipStatus.textContent = effects.length ? effects.join(" · ") : "正常方向";
}

function toggleImageMirror() {
  imageFlipped = !imageFlipped;
  renderImageOrientation();
}

function toggleImageVerticalFlip() {
  imageVerticallyFlipped = !imageVerticallyFlipped;
  renderImageOrientation();
}

function toggleImageColorInversion() {
  imageColorsInverted = !imageColorsInverted;
  renderImageOrientation();
}

function setGesture(label, detail) {
  gestureLabel.textContent = label;
  gestureDetail.textContent = detail;
}

function showAction(label, detail) {
  setGesture(label, detail);
}

function nextImage() {
  showImage(currentIndex + 1);
  showAction("手掌右移", "已切換到下一張圖片");
}

function previousImage() {
  showImage(currentIndex - 1);
  showAction("手掌左移", "已切換到上一張圖片");
}

function distanceFromWrist(landmarks, pointIndex) {
  const wrist = landmarks[0];
  const point = landmarks[pointIndex];
  return Math.hypot(point.x - wrist.x, point.y - wrist.y);
}

function fingerIsExtended(landmark, tipIndex, pipIndex) {
  const tipDistance = distanceFromWrist(landmark, tipIndex);
  const pipDistance = distanceFromWrist(landmark, pipIndex);
  return tipDistance > pipDistance * 1.1;
}

function getExtendedFingerState(landmark) {
  return [
    fingerIsExtended(landmark, 8, 6),
    fingerIsExtended(landmark, 12, 10),
    fingerIsExtended(landmark, 16, 14),
    fingerIsExtended(landmark, 20, 18),
  ];
}

function identifySingleFinger(landmark, categories) {
  const pointingUp = categories.some((category) => category.categoryName === "Pointing_Up" && category.score >= 0.4);
  if (pointingUp) return "index";
  const extended = getExtendedFingerState(landmark);
  const [index, middle, ring, pinky] = extended;
  if (index && !middle && !ring && !pinky) return "index";
  if (!index && middle && !ring && !pinky) return "middle";
  if (!index && !middle && !ring && pinky) return "pinky";
  return null;
}

function palmCenter(landmark) {
  return (landmark[0].x + landmark[5].x + landmark[9].x + landmark[13].x + landmark[17].x) / 5;
}

function palmFacingScore(landmark) {
  const wrist = landmark[0];
  const indexBase = landmark[5];
  const pinkyBase = landmark[17];
  const ax = indexBase.x - wrist.x;
  const ay = indexBase.y - wrist.y;
  const az = indexBase.z - wrist.z;
  const bx = pinkyBase.x - wrist.x;
  const by = pinkyBase.y - wrist.y;
  const bz = pinkyBase.z - wrist.z;
  const normalX = ay * bz - az * by;
  const normalY = az * bx - ax * bz;
  const normalZ = ax * by - ay * bx;
  const normalLength = Math.hypot(normalX, normalY, normalZ);
  return normalLength > 0 ? normalZ / normalLength : 0;
}

function updateHandFacing(result) {
  const landmarksByHand = result.landmarks ?? [];
  let flipped = false;

  landmarksByHand.forEach((landmark, handIndex) => {
    const categories = result.gestures?.[handIndex] ?? [];
    const openPalm = categories.some((category) => category.categoryName === "Open_Palm" && category.score >= 0.4)
      || getExtendedFingerState(landmark).every(Boolean);
    if (!openPalm) return;

    const handedness = result.handedness?.[handIndex]?.[0]?.categoryName ?? `hand-${handIndex}`;
    const state = handFacingStates.get(handedness) ?? { facing: 0, candidate: 0, frames: 0 };
    const score = palmFacingScore(result.worldLandmarks?.[handIndex] ?? landmark);
    const sign = score >= 0.45 ? 1 : score <= -0.45 ? -1 : 0;
    if (!sign) {
      state.candidate = 0;
      state.frames = 0;
      handFacingStates.set(handedness, state);
      return;
    }

    if (sign === state.candidate) state.frames += 1;
    else {
      state.candidate = sign;
      state.frames = 1;
    }
    if (state.frames >= 4) {
      if (state.facing !== 0 && state.facing !== sign) flipped = true;
      state.facing = sign;
      state.candidate = 0;
      state.frames = 0;
    }
    handFacingStates.set(handedness, state);
  });

  return flipped;
}

async function createRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
  );
  return GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  });
}

function applyHandAction(landmark, categories) {
  const now = performance.now();
  const thumbDown = categories.some((category) => category.categoryName === "Thumb_Down" && category.score >= 0.5);
  if (thumbDown) {
    lastPalmX = null;
    if (latchedFingerGesture !== "thumb-down" && now - lastActionAt >= actionCooldownMs) {
      toggleImageColorInversion();
      showAction("倒讚", imageColorsInverted ? "圖片色彩已反相" : "圖片色彩已恢復");
      lastActionAt = now;
      latchedFingerGesture = "thumb-down";
    }
    return;
  }

  const finger = identifySingleFinger(landmark, categories);
  if (finger) {
    lastPalmX = null;
    if (finger !== latchedFingerGesture && now - lastActionAt >= actionCooldownMs) {
      if (finger === "index") {
        showImage(0);
        showAction("食指", "已回到第一張圖片");
      } else if (finger === "middle") {
        toggleImageVerticalFlip();
        showAction("中指", imageVerticallyFlipped ? "圖片已上下翻轉" : "圖片已恢復上下方向");
      } else {
        showImage(gallery.length - 1);
        showAction("小指", "已跳到最後一張圖片");
      }
      lastActionAt = now;
      latchedFingerGesture = finger;
    }
    return;
  }

  latchedFingerGesture = null;
  const openPalmByModel = categories.some((category) => category.categoryName === "Open_Palm" && category.score >= 0.45);
  const openPalmByLandmarks = getExtendedFingerState(landmark).every(Boolean);
  const openPalm = openPalmByModel || openPalmByLandmarks;
  if (!openPalm) {
    lastPalmX = null;
    const recognized = categories.reduce((best, category) => category.score > (best?.score ?? 0) ? category : best, null);
    if (recognized && recognized.categoryName !== "None" && recognized.score >= 0.4) {
      setGesture(`偵測到手勢：${recognized.categoryName}`, "目前控制方式：張開手掌左右移，或只伸食指／小指");
    } else {
      setGesture("已偵測到手部", "張開手掌左右移，或只伸食指／小指來控制圖片");
    }
    return;
  }

  // The preview is mirrored, so invert model x to match the user's left/right view.
  const mirroredX = 1 - palmCenter(landmark);
  if (lastPalmX !== null) {
    const movement = mirroredX - lastPalmX;
    if (movement <= -movementThreshold && now - lastActionAt >= actionCooldownMs) {
      previousImage();
      lastActionAt = now;
      lastPalmX = mirroredX;
      return;
    }
    if (movement >= movementThreshold && now - lastActionAt >= actionCooldownMs) {
      nextImage();
      lastActionAt = now;
      lastPalmX = mirroredX;
      return;
    }
  }
  if (lastPalmX === null) lastPalmX = mirroredX;
  setGesture("偵測到手掌", "左右移動手掌切換圖片");
}

function renderFrame() {
  if (!running || !recognizer) return;
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = recognizer.recognizeForVideo(video, performance.now());
      const landmark = result.landmarks?.[0];
      const categories = result.gestures?.[0] ?? [];
      if (landmark) {
        if (updateHandFacing(result)) {
          toggleImageMirror();
          lastPalmX = null;
          lastActionAt = performance.now();
          latchedFingerGesture = identifySingleFinger(landmark, categories);
          setGesture("手心／手背翻面", imageFlipped ? "圖片已左右翻轉" : "圖片已恢復正常方向");
        } else {
          applyHandAction(landmark, categories);
        }
      } else {
        lastPalmX = null;
        latchedFingerGesture = null;
        setGesture("未偵測到手部", "請把手掌移入畫面，並保持光線充足");
      }
    }
  } catch (error) {
    running = false;
    setGesture("辨識發生錯誤", "請關閉相機後重新啟動");
    notice.textContent = `辨識錯誤：${error.message}`;
    console.error(error);
    return;
  }
  requestAnimationFrame(renderFrame);
}

async function startCamera() {
  cameraButton.disabled = true;
  cameraButton.textContent = "正在啟動…";
  notice.textContent = "";
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("此瀏覽器無法存取相機，請使用支援 HTTPS 的瀏覽器開啟。");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    lastPalmX = null;
    cameraStage.classList.add("is-live");
    placeholder.hidden = true;
    stageChip.innerHTML = "<span></span> 相機辨識中";
    cameraButton.innerHTML = '關閉相機 <span aria-hidden="true">×</span>';
    cameraButton.disabled = false;
    setGesture("相機已啟動", "正在載入手勢辨識模型…");
    if (!recognizer) {
      try {
        recognizer = await createRecognizer();
      } catch (error) {
        setGesture("相機已開啟", "辨識模型載入失敗，請檢查網路後重新開啟相機");
        notice.textContent = `無法載入手勢模型：${error.message}`;
        console.error(error);
        return;
      }
    }
    setGesture("相機已啟動", "移動手掌或伸出食指、小指控制圖片");
    requestAnimationFrame(renderFrame);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    cameraButton.disabled = false;
    cameraButton.innerHTML = '開啟相機 <span aria-hidden="true">↗</span>';
    notice.textContent = error.name === "NotAllowedError"
      ? "相機權限未開啟。請在瀏覽器允許相機存取後重試。"
      : `無法啟動辨識：${error.message}`;
    console.error(error);
  }
}

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.srcObject = null;
  cameraStage.classList.remove("is-live");
  placeholder.hidden = false;
  stageChip.innerHTML = "<span></span> 等待相機";
  cameraButton.innerHTML = '開啟相機 <span aria-hidden="true">↗</span>';
  setGesture("相機已關閉", "可以使用圖片下方按鈕控制播放");
}

cameraButton.addEventListener("click", () => {
  if (running) stopCamera();
  else startCamera();
});

document.querySelector("#first-button").addEventListener("click", () => {
  showImage(0);
  showAction("按鈕控制", "已回到第一張圖片");
});
document.querySelector("#previous-button").addEventListener("click", () => {
  showImage(currentIndex - 1);
  showAction("按鈕控制", "已切換到上一張圖片");
});
document.querySelector("#next-button").addEventListener("click", () => {
  showImage(currentIndex + 1);
  showAction("按鈕控制", "已切換到下一張圖片");
});
document.querySelector("#last-button").addEventListener("click", () => {
  showImage(gallery.length - 1);
  showAction("按鈕控制", "已跳到最後一張圖片");
});

window.addEventListener("pagehide", () => {
  running = false;
  stream?.getTracks().forEach((track) => track.stop());
  recognizer?.close();
});
