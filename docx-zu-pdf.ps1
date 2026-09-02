# docx-zu-pdf.ps1 — konvertiert ALLE .docx eines Ordners per Microsoft Word (COM) nach PDF.
#
# Für die im Tool „Dokumentenvorlagen" erzeugten Serienbrief-Dokumente: ZIP entpacken,
# dieses Skript über den Ordner laufen lassen — Originallayout bleibt 1:1 erhalten, die
# Daten (inkl. IBAN) verlassen den Rechner nicht (Word-Export ist rein lokal).
#
# Aufruf (PowerShell im Ordner mit den .docx):
#   .\docx-zu-pdf.ps1                      -> konvertiert alle .docx im aktuellen Ordner
#   .\docx-zu-pdf.ps1 -InputDir "C:\Pfad"  -> anderer Quellordner
#   .\docx-zu-pdf.ps1 -OutDir "C:\Pfad"    -> PDFs woanders ablegen (Default: neben den .docx)
#
# Voraussetzung: installiertes Microsoft Word (Desktop). Rein lokal, kein Internet.

param(
  [string]$InputDir = ".",
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$InputDir = (Resolve-Path $InputDir).Path
if (-not $OutDir) { $OutDir = $InputDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Word-Lockdateien (~$name.docx) und bereits vorhandene PDFs ausschliessen.
$docxFiles = Get-ChildItem -Path $InputDir -Filter *.docx -File | Where-Object { $_.Name -notlike '~$*' }
if (-not $docxFiles -or @($docxFiles).Count -eq 0) { throw "Keine .docx-Dateien in $InputDir gefunden." }

$tasks = @()
foreach ($f in $docxFiles) {
  $pdf = Join-Path $OutDir ($f.BaseName + '.pdf')
  Unblock-File $f.FullName -ErrorAction SilentlyContinue   # Zone-Markierung entfernen -> kein Protected View
  $tasks += @{ name = $f.Name; docx = $f.FullName; pdf = $pdf }
}
Write-Host ("{0} .docx gefunden in {1}" -f @($tasks).Count, $InputDir) -ForegroundColor Cyan

# Acrobat PDFMaker vor dem Word-Start temporaer deaktivieren (kann ExportAsFixedFormat
# blockieren); im finally wiederherstellen.
$pdfMakerKey   = 'HKCU:\Software\Microsoft\Office\Word\Addins\PDFMaker.OfficeAddin'
$pdfMakerSaved = $null
if (Test-Path $pdfMakerKey) {
  $pdfMakerSaved = (Get-ItemProperty $pdfMakerKey -Name LoadBehavior -ErrorAction SilentlyContinue).LoadBehavior
  Set-ItemProperty $pdfMakerKey -Name LoadBehavior -Value 0 -ErrorAction SilentlyContinue
}

$ok = 0; $fail = 0
try {
  # WICHTIG: $doc.ExportAsFixedFormat HAENGT auf manchen Maschinen, wenn es direkt im
  # Haupt-PowerShell-Prozess laeuft (Word rechnet sich in einer Render-Schleife tot).
  # Derselbe Aufruf in einem per Start-Job abgespaltenen Child-Prozess laeuft zuverlaessig
  # durch. Darum die KOMPLETTE Word-Schleife im Job; der Hauptprozess wacht nur per
  # Watchdog darueber und beendet WINWORD hart, falls doch etwas klemmt.
  $exportJob = Start-Job -ScriptBlock {
    param($tasks)
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    try { $word.AutomationSecurity = 3 } catch {}          # Makros beim Oeffnen aus
    try { $word.Options.UpdateFieldsAtPrint = $false } catch {}
    try { $word.Options.UpdateLinksAtPrint  = $false } catch {}
    foreach ($t in $tasks) {
      try {
        # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
        $doc = $word.Documents.Open($t.docx, $false, $true, $false)
        if ($word.ProtectedViewWindows.Count -gt 0) { $doc = $word.ProtectedViewWindows.Item(1).Edit() }
        # ExportAsFixedFormat(OutputFileName, 17=wdExportFormatPDF, OpenAfterExport=$false)
        $doc.ExportAsFixedFormat($t.pdf, 17, $false)
        $doc.Close($false)
        Write-Output ("OK|{0}" -f $t.name)
      } catch {
        Write-Output ("FEHLER|{0}|{1}" -f $t.name, $_.Exception.Message)
      }
    }
    try { $word.Quit() } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  } -ArgumentList (,$tasks)

  $timeoutSec = 60 + 30 * @($tasks).Count    # grosszuegiges Zeitbudget je Dokument
  Write-Host ("Exportiere {0} PDF(s) in Word (Timeout {1}s) ..." -f @($tasks).Count, $timeoutSec)
  $done = Wait-Job $exportJob -Timeout $timeoutSec
  if ($null -eq $done) {
    Write-Host "  TIMEOUT: Word-Export haengt — beende WINWORD." -ForegroundColor Red
    Stop-Job $exportJob -ErrorAction SilentlyContinue
    Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $fail += @($tasks).Count
  } else {
    Receive-Job $exportJob | ForEach-Object {
      $p = $_ -split '\|'
      if ($p[0] -eq 'OK')     { Write-Host ("  OK  {0}" -f $p[1]) -ForegroundColor Green; $ok++ }
      elseif ($p[0] -eq 'FEHLER') { Write-Host ("  FEHLER bei {0}: {1}" -f $p[1], $p[2]) -ForegroundColor Red; $fail++ }
    }
  }
  Remove-Job $exportJob -Force -ErrorAction SilentlyContinue
} finally {
  if ($null -ne $pdfMakerSaved) {
    Set-ItemProperty $pdfMakerKey -Name LoadBehavior -Value $pdfMakerSaved -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host ("Fertig: {0} PDF(s) erstellt, {1} Fehler." -f $ok, $fail) -ForegroundColor Cyan
Write-Host ("Ordner: {0}" -f $OutDir)
