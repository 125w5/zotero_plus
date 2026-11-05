@echo off
rem Opens the source-built EasySch client with its own profile and library
rem (..\.tools\research-native-profile and research-native-data). Build it first
rem with scripts\build-native.ps1.
setlocal
set "PS=pwsh.exe"
where pwsh.exe >nul 2>nul || set "PS=powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-research.ps1" %*
if errorlevel 1 (
	echo.
	echo EasySch did not start. See the message above.
	pause
)
endlocal
