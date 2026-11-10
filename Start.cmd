@echo off
setlocal
cd /d "%~dp0"
if not exist "main.exe" goto missingFiles
if not exist "stub.exe" goto missingFiles
if not exist "yt-dlp.exe" goto missingFiles
if not exist "yt-dlp.conf" goto missingFiles
if not exist "ffmpeg.exe" goto missingFfmpeg
where node.exe >nul 2>nul
if errorlevel 1 goto missingNode
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto missingNode
if /i "%~1"=="--check" goto checkOnly
main.exe
set "toolExit=%errorlevel%"
if not "%toolExit%"=="0" pause
exit /b %toolExit%

:checkOnly
node.exe --version
yt-dlp.exe --version
ffmpeg.exe -version
echo Prerequisites OK.
exit /b 0

:missingNode
echo Install Node.js 22 or newer from https://nodejs.org/ and reopen this launcher.
pause
exit /b 1

:missingFfmpeg
echo Download a Windows FFmpeg build from https://ffmpeg.org/download.html
echo Put ffmpeg.exe next to main.exe. This dependency is required for lossless mode.
echo If using a custom ffmpeg-path or a legacy mode, launch main.exe directly.
pause
exit /b 1

:missingFiles
echo Extract the complete Windows ZIP from https://github.com/Quin520/Vrc-Youtube-Tool/releases
pause
exit /b 1
