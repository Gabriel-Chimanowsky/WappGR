[CmdletBinding()]
param([string]$OutputFile)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new()
[Console]::OutputEncoding = $OutputEncoding
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputFile) { $OutputFile = Join-Path $ProjectRoot 'docs\validacao\windows-task.json' }
$TestRoot = Join-Path $ProjectRoot ('.npm-cache\windows-task-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TestRoot | Out-Null
$NodePath = (Get-Command node.exe).Source
$TaskName = 'WappGR-Validation-' + [Guid]::NewGuid().ToString('N')
$Ops = Join-Path $ProjectRoot 'scripts\windows.ps1'
$EnvPath = Join-Path $TestRoot 'test.env'
$RuntimeDir = Join-Path $TestRoot 'runtime'
$AuthDir = Join-Path $TestRoot 'auth'
New-Item -ItemType Directory -Path $AuthDir | Out-Null
$Sentinel = '{"synthetic-only":true}'
[IO.File]::WriteAllText((Join-Path $AuthDir 'creds.json'), $Sentinel)
$Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$Listener.Start(); $Port = $Listener.LocalEndpoint.Port; $Listener.Stop()
$env:WAPPGR_DB_PATH = Join-Path $TestRoot 'synthetic.db'
$env:WAPPGR_AUTH_DIR = $AuthDir
$env:WAPPGR_RUNTIME_DIR = $RuntimeDir
$env:WAPPGR_DISABLE_WHATSAPP = '1'
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$Text = "HOST=127.0.0.1`nPORT=$Port`nWAPPGR_DISABLE_WHATSAPP=1`nWAPPGR_DB_PATH=$($env:WAPPGR_DB_PATH)`nWAPPGR_AUTH_DIR=$AuthDir`nWAPPGR_RUNTIME_DIR=$RuntimeDir`n"
[IO.File]::WriteAllText($EnvPath,$Text,[Text.UTF8Encoding]::new($false))
$Result = [ordered]@{date=[DateTime]::UtcNow.ToString('o');taskName=$TaskName;testRoot=$TestRoot;whatsappDisabled=$true;registered=$false;startupTriggerVerified=$false;actualWindowsRebootTested=$false;started=$false;duplicatePrevented=$false;stopped=$false;removed=$false;steps=@()}
function Invoke-Operation([string]$Operation,[switch]$Prepare) {
    $Parameters = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$Ops,$Operation,'-TaskName',$TaskName,'-EnvFile',$EnvPath,'-NodePath',$NodePath)
    if ($Prepare) { $Parameters += '-PrepareOnly' }
    $Lines = & powershell.exe @Parameters 2>&1
    $Code = $LASTEXITCODE
    $Result.steps += @{operation=$Operation;exitCode=$Code;output=($Lines -join "`n")}
    if ($Code -ne 0) { throw "Operação $Operation falhou: $($Lines -join ' ')" }
    return ($Lines -join "`n" | ConvertFrom-Json)
}
try {
    $Principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $Result.administrator = $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    try { Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null; $Result.taskSchedulerQuerySucceeded = $true }
    catch { $Result.taskSchedulerQuerySucceeded = $_.CategoryInfo.Category -eq 'ObjectNotFound'; $Result.taskSchedulerQueryError = $_.Exception.Message }
    $Plan = Invoke-Operation 'install' -Prepare
    $Result.plan = $Plan.xml
    try {
        $Schedule = New-Object -ComObject Schedule.Service
        $Schedule.Connect()
        $Definition = $Schedule.NewTask(0)
        $Definition.XmlText = [IO.File]::ReadAllText($Plan.xml)
        $Result.xmlValidatedByTaskScheduler = $true
    } catch {
        $Result.xmlValidatedByTaskScheduler = $false
        $Result.xmlValidationError = $_.Exception.Message
        if ($_.Exception.Message -match 'LogonType|XML|schema|esquema') { throw }
    }
    if (-not $Result.administrator) {
        $Result.reason = 'Sessão sem privilégios de Administrador: tarefa SYSTEM não registrada. XML e scripts preparados e testados.'
    } else {
        $Registration = Invoke-Operation 'install'
        $Result.registered = $Registration.registered
        $Task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\'
        $Result.startupTriggerVerified = $Task.Triggers.CimClass.CimClassName -contains 'MSFT_TaskBootTrigger'
        $Running = Invoke-Operation 'start'
        $Result.started = $Running.runtime.backendAlive -and $Running.runtime.healthFresh
        $Second = Invoke-Operation 'start'
        $Result.duplicatePrevented = $Running.runtime.supervisor.childPid -eq $Second.runtime.supervisor.childPid
        $Result.health = $Second.runtime.health
        $Stop = Invoke-Operation 'stop'
        $Result.stopped = -not $Stop.runtime.backendAlive -and -not $Stop.runtime.supervisorAlive
        $Result.credentialsPreserved = [IO.File]::ReadAllText((Join-Path $AuthDir 'creds.json')) -eq $Sentinel
        if (-not ($Result.registered -and $Result.startupTriggerVerified -and $Result.started -and $Result.duplicatePrevented -and $Result.stopped -and $Result.credentialsPreserved)) { throw 'Uma verificação da tarefa falhou.' }
    }
} catch { $Result.error = $_.ToString() }
finally {
    if ($Result.registered) {
        try { $Removed = Invoke-Operation 'remove'; $Result.removed = -not $Removed.registered } catch { $Result.cleanupError = $_.ToString() }
    }
    [IO.File]::WriteAllText($OutputFile,($Result | ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
}
$Result | ConvertTo-Json -Depth 15
if ($Result.error -or $Result.cleanupError) { exit 1 }
