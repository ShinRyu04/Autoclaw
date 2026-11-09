' Autoclaw launcher (hidden, tanpa jendela CMD)
' Delegasi ke watchdog.ps1 - aman dijalankan berkali-kali:
' port yang sudah hidup tidak dibuatkan proses baru, yang mati dinyalakan.
' Ini juga yang dipanggil Scheduled Task "Autoclaw-Watchdog".

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "watchdog.ps1")
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptPath & """"
shell.Run cmd, 0, False
