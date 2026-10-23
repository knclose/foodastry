@echo off
chcp 65001 >nul
title Foodastry — отправка в бета-версию
cd /d "%~dp0"

echo.
echo  === Foodastry: выкатить изменения в БЕТА-версию ===
echo  (сайт-черновик: https://knclose.github.io/foodastry-beta/)
echo.

set "MSG="
set /p MSG="Что изменилось (коротко, Enter = общая формулировка): "
if "%MSG%"=="" set "MSG=Обновление сайта"

git add -A
git commit -m "%MSG%"
if errorlevel 1 (
    echo.
    echo  [!] Изменений нет или git не найден — нечего отправлять.
    pause
    exit /b 1
)

echo.
echo  Отправляю в бета-репозиторий...
git push beta dev:main

echo.
echo  Готово. Через 30-60 секунд бета-сайт обновится:
echo  https://knclose.github.io/foodastry-beta/
echo  (если страница не изменилась — обновите её с очисткой кэша: Ctrl+F5)
echo.
pause
