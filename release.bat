@echo off
chcp 65001 >nul
title Foodastry — публикация на основной сайт
cd /d "%~dp0"

echo.
echo  === Foodastry: ПУБЛИКАЦИЯ на основной сайт ===
echo  (https://knclose.github.io/foodastry/)
echo.
echo  Перед публикацией стоит проверить изменения на бета-сайте!
echo.

set /p SURE="Публикуем? (Enter = да, любая буква = отмена): "
if not "%SURE%"=="" exit /b 0

echo.
git push origin dev:main
if errorlevel 1 (
    echo.
    echo  [!] Не получилось — проверьте интернет или повторите.
    pause
    exit /b 1
)

:: локальная ветка main догоняет опубликованное
git branch -f main dev

echo.
echo  Опубликовано. Через 30-60 секунд обновится основной сайт:
echo  https://knclose.github.io/foodastry/
echo  (кэш: Ctrl+F5)
echo.
pause
