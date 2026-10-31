(function_def) @function
(macro_def) @function
(block_def) @function
(function_command (argument_list (argument) @parameter))
(macro_command (argument_list (argument) @parameter))
(if_condition) @branch
(elseif_command) @branch
(else_command) @branch
(foreach_loop) @loop
(while_loop) @loop
(if_condition) @nesting
(foreach_loop) @nesting
(while_loop) @nesting
(function_def) @nesting
(macro_def) @nesting
(block_def) @nesting
