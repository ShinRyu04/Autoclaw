' Launcher hidden untuk PowerShell (pengganti aksi scheduled task yang flash)
' Pakai: wscript.exe //B //Nologo run-ps-hidden.vbs "script.ps1"
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """"
sh.Run cmd, 0, False
