' Autoclaw launcher (hidden, tanpa jendela CMD)
' Delegasi ke watchdog.ps1 - aman dijalankan berkali-kali:
' port yang sudah hidup tidak dibuatkan proses baru, yang mati dinyalakan.
' Ini juga yang dipanggil Scheduled Task "Autoclaw-Watchdog".

Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""D:\ToolsAI\glmproxy\watchdog.ps1"" "
shell.Run cmd, 0, False
