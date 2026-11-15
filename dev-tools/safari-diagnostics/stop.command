#!/bin/zsh
script_dir="${0:A:h}"
python3 -u -B "$script_dir/service.py" stop
command_status=$?
print
read "?按回车关闭此窗口。"
exit "$command_status"
