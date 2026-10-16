[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('install','start','stop','status','remove')][string]$Action = 'status',
    [string]$TaskName = 'WappGR-Backend',
    [string]$EnvFile,
    [string]$NodePath,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new()
[Console]::OutputEncoding = $OutputEncoding
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not $EnvFile) { $EnvFile = Join-Path $ProjectRoot '.env' }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)
$ControlPath = Join-Path $ProjectRoot 'server\service-control.js'
function Invoke-Control([string]$Command) {
    $Lines = & $NodePath $ControlPath $Command '--env-file-path' $EnvFile
    if ($LASTEXITCODE -ne 0) { throw "Comando $Command falhou. Consulte a mensagem acima." }
    return ($Lines -join "`n" | ConvertFrom-Json)
}
$Config = Invoke-Control 'config'
function Get-Task {
    try { return Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop }
    catch {
        if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { return $null }
        throw
    }
}
function Assert-OurTask($Task) {
    if ($Task -and ($Task.Actions.Count -ne 1 -or $Task.Actions[0].Execute -ne $NodePath -or $Task.Actions[0].WorkingDirectory -ne $ProjectRoot -or $Task.Actions[0].Arguments -ne $Arguments)) {
        throw "O nome $TaskName pertence a outra configuração. Não foi sobrescrito."
    }
}
function Get-State {
    $TaskError = $null
    try { $Task = Get-Task } catch { $Task = $null; $TaskError = $_.Exception.Message }
    $Runtime = Invoke-Control 'status'
    $Info = if ($Task) { Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\' }
    return [ordered]@{ taskName=$TaskName; registered=$(if($TaskError){$null}else{[bool]$Task}); taskState=$(if($TaskError){'UNKNOWN'}elseif($Task){[string]$Task.State}else{'NOT_INSTALLED'}); taskQueryError=$TaskError; lastTaskResult=$(if($Info){$Info.LastTaskResult}else{$null}); runtime=$Runtime }
}
function Stop-Backend {
    Invoke-Control 'stop' | Out-Null
    $Deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $Runtime = Invoke-Control 'status'
        if (-not $Runtime.supervisorAlive -and -not $Runtime.backendAlive) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $Deadline)
    $Task = Get-Task
    if ($Runtime.supervisorAlive -and $Task -and $Task.State -eq 'Running') {
        Write-Warning 'Supervisor não encerrou no prazo; a tarefa será interrompida. Chamadas interrompidas ficam incertas na recuperação.'
        Stop-ScheduledTask -TaskName $TaskName -TaskPath '\'
        Start-Sleep -Seconds 2
        $Runtime = Invoke-Control 'status'
    }
    if ($Runtime.supervisorAlive -or $Runtime.backendAlive) { throw 'Ainda há processo ativo. Nenhuma instância avulsa foi encerrada; verifique service:status.' }
}
$Arguments = '"' + $Config.supervisorPath + '" --env-file-path "' + $EnvFile + '"'
try {
    if ($Action -eq 'status') { Get-State | ConvertTo-Json -Depth 12; exit 0 }
    if ($Action -eq 'install') {
        $Check = Invoke-Control 'preflight'
        $Escape = { param($Value) [Security.SecurityElement]::Escape($Value) }
        $ExecutableXml = & $Escape $NodePath
        $ArgumentsXml = & $Escape $Arguments
        $DirectoryXml = & $Escape $ProjectRoot
        $Xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>WappGR: backend Baileys e supervisor; $DirectoryXml</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger></Triggers>
  <Principals><Principal id="System"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
  <Actions Context="System"><Exec><Command>$ExecutableXml</Command><Arguments>$ArgumentsXml</Arguments><WorkingDirectory>$DirectoryXml</WorkingDirectory></Exec></Actions>
</Task>
"@
        New-Item -ItemType Directory -Path $Config.runtimeDir -Force | Out-Null
        $PlanPath = Join-Path $Config.runtimeDir 'task.xml'
        [IO.File]::WriteAllText($PlanPath, $Xml, [Text.Encoding]::Unicode)
        if ($PrepareOnly) { @{registered=$false; prepared=$true; xml=$PlanPath; backendAlreadyRunning=$Check.backendAlreadyRunning} | ConvertTo-Json; exit 0 }
        $Principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Instalação exige PowerShell como Administrador. XML preparado em $PlanPath; tarefa NÃO registrada." }
        $Existing = Get-Task
        Assert-OurTask $Existing
        if (-not $Existing) { Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Xml $Xml -User 'SYSTEM' | Out-Null }
        $Verified = Get-Task
        Assert-OurTask $Verified
        if (-not $Verified -or $Verified.Principal.UserId -notin @('SYSTEM','S-1-5-18') -or $Verified.Triggers.CimClass.CimClassName -notcontains 'MSFT_TaskBootTrigger') { throw 'Registro não confirmado. Verifique o Agendador de Tarefas.' }
        # Registration does not start a second backend or replace any running instance.
        Get-State | ConvertTo-Json -Depth 12
        exit 0
    }
    $Task = Get-Task
    Assert-OurTask $Task
    if ($Action -eq 'stop') { Stop-Backend; Get-State | ConvertTo-Json -Depth 12; exit 0 }
    if ($Action -eq 'remove') {
        Stop-Backend
        if ($Task) { Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false }
        if (Get-Task) { throw 'A tarefa ainda está registrada.' }
        Get-State | ConvertTo-Json -Depth 12; exit 0
    }
    if (-not $Task) { throw 'Tarefa não instalada. Execute service:install como Administrador.' }
    Invoke-Control 'preflight' | Out-Null
    $Start = Invoke-Control 'start'
    if (-not $Start.alreadyRunning) {
        Enable-ScheduledTask -TaskName $TaskName -TaskPath '\' | Out-Null
        Start-ScheduledTask -TaskName $TaskName -TaskPath '\'
    }
    $Deadline = [DateTime]::UtcNow.AddSeconds(50)
    do {
        $State = Get-State
        if ($State.runtime.supervisor.state -eq 'BLOCKED') { throw $State.runtime.supervisor.reason }
        if ($State.runtime.supervisorAlive -and $State.runtime.backendAlive -and $State.runtime.healthFresh) { $State | ConvertTo-Json -Depth 12; exit 0 }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw 'Início não confirmado no prazo; consulte service:status e os logs. Não execute outra instância.'
} catch { Write-Error $_; exit 1 }
