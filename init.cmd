@echo off
python "%~dp0tools\check_handoff.py" %*
exit /b %errorlevel%
