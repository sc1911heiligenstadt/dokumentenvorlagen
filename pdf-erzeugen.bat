@echo off
rem Wandelt ALLE Word-Dateien in DIESEM Ordner in PDF um.
rem
rem So geht es:
rem   1. Das erzeugte ZIP entpacken.
rem   2. Diese Datei UND docx-zu-pdf.ps1 in den entpackten Ordner legen.
rem   3. Doppelklick auf diese Datei.
rem
rem Braucht ein installiertes Microsoft Word. Es geht nichts ins Internet --
rem der Export laeuft rein oertlich auf diesem Rechner.
rem
rem Der Umweg ueber diese Datei ist noetig, weil Windows ein PowerShell-Skript
rem per Doppelklick nicht ausfuehrt (es oeffnet stattdessen den Editor).
cd /d "%~dp0"
if not exist "%~dp0docx-zu-pdf.ps1" (
  echo.
  echo   Es fehlt die Datei docx-zu-pdf.ps1 in diesem Ordner.
  echo   Beide Dateien gehoeren zusammen -- lade sie im Tool unter
  echo   Einstellungen herunter und lege sie hierher.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docx-zu-pdf.ps1"
pause
