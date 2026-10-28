# 20261028_gesture｜手勢偵測

以 Flask 提供網頁、以瀏覽器端 MediaPipe Gesture Recognizer 偵測即時手勢，預計部署到 Render。相機影像在使用者瀏覽器中處理，不會傳到 Flask 伺服器。桌面版左側是相機控制區，右側是圖片展示和播放按鈕。

## 規劃流程

1. **網頁與部署骨架**：建立 Flask 首頁、健康檢查端點，以及 Render Blueprint 設定。
2. **相機輸入**：由瀏覽器請求相機權限，顯示即時影像；部署環境使用 HTTPS。
3. **手勢辨識**：載入 MediaPipe Gesture Recognizer，在瀏覽器本機逐格辨識手部關鍵點。
4. **圖片播放**：手掌向左移切到上一張、向右移切到下一張；只伸食指回到第一張，只伸中指上下翻轉圖片，只伸小指跳到最後一張；手心與手背翻面時切換圖片鏡像；比倒讚時切換色彩反相。
5. **按鈕操作**：提供上一張、下一張、第一張和最後一張按鈕，並可獨立開關相機。
6. **本機確認**：安裝 Python 套件後啟動 Flask，確認首頁和 `/health` 可用；在支援相機的瀏覽器確認辨識功能。
7. **部署 Render**：將專案推送到 GitHub，在 Render 建立 Blueprint 或 Web Service；使用 `pip install -r requirements.txt` 建置，以 Gunicorn 啟動 `main:app`。
8. **後續擴充**：依需求換成自選圖片、加入自訂手勢或增加圖片管理功能。

## 套件安裝清單

### Python（Render 與 Flask 伺服器）

| 套件 | 用途 |
| --- | --- |
| `flask==3.1.3` | 提供網頁和 `/health` 健康檢查路由 |
| `gunicorn==23.0.0` | Render production WSGI 伺服器 |

`requirements.txt` 已由 `uv.lock` 匯出，並鎖定 Flask、Gunicorn 和傳遞依賴版本。更新依賴後請執行：

```bash
uv lock
uv export --locked --no-dev --no-emit-project --no-hashes --format requirements-txt --output-file requirements.txt
```

安裝指令：

```bash
python -m pip install -r requirements.txt
```

本機啟動：

```bash
python main.py
```

### 瀏覽器端

MediaPipe Tasks Vision `0.10.35` 由 jsDelivr CDN 載入，模型檔由 Google MediaPipe 模型庫載入；目前不需要額外的 Python、npm 或系統級影像套件。展示用 SVG 範例圖已放在 `static/images/`。

## Render 設定

專案已附 `render.yaml`：

- Build Command：`pip install -r requirements.txt`
- Start Command：`gunicorn main:app --bind 0.0.0.0:$PORT`
- Health Check Path：`/health`

Render Web Service 的設定和 Gunicorn 啟動方式依據 [Render Flask 部署文件](https://render.com/docs/deploy-flask)。首次使用相機時，需在瀏覽器允許相機權限。
