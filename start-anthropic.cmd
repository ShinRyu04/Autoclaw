@echo off
rem Autoclaw - launcher dari AI Toolbox.
rem Menyalakan apa pun yang mati: AutoClaw (bila perlu), OpenAI 18791,
rem Anthropic 18792, dan dashboard 18793. Aman dijalankan berulang.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\ToolsAI\glmproxy\watchdog.ps1"
