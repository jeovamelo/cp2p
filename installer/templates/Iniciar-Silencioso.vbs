Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = currentDir

Dim nodeBin
If fso.FileExists(currentDir & "\bin\node.exe") Then
    nodeBin = """" & currentDir & "\bin\node.exe"""
Else
    nodeBin = "node"
End If

WshShell.Environment("PROCESS")("AUTO_OPEN") = "true"
WshShell.Environment("PROCESS")("HTTP_PORT") = "5001"
WshShell.Environment("PROCESS")("P2P_PORT") = "6001"
WshShell.Environment("PROCESS")("ROLE") = "Membro"

WshShell.Run nodeBin & " src/desktop/desktop_runner.js", 0, False
