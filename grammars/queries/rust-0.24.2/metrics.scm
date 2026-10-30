(function_item) @function
(closure_expression) @function
(parameters [(parameter) (self_parameter)] @parameter)
(closure_parameters [(identifier) (parameter)] @parameter)
(if_expression) @branch
(match_arm) @branch
(for_expression) @loop
(while_expression) @loop
(loop_expression) @loop
(binary_expression operator: ["&&" "||"]) @boolean
(if_expression) @nesting
(match_expression) @nesting
(for_expression) @nesting
(while_expression) @nesting
(loop_expression) @nesting
