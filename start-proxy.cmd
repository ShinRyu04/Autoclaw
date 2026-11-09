@echo off
rem Autoclaw - pastikan AutoClaw + kedua endpoint + dashboard hidup.
rem Delegasi ke watchdog.ps1 supaya cek port dan logika restart cuma ada di satu tempat.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\ToolsAI\glmproxy\watchdog.ps1"
