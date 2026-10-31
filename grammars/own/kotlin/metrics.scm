(function_declaration) @function
(lambda_literal) @function
(anonymous_function) @function
(function_value_parameters (parameter) @parameter)
(lambda_parameters (_) @parameter)
(if_expression) @branch
(when_entry) @branch
(catch_block) @branch
(binary_expression "?:") @branch
(for_statement) @loop
(while_statement) @loop
(do_while_statement) @loop
(binary_expression ["&&" "||"]) @boolean
(if_expression) @nesting
(when_expression) @nesting
(for_statement) @nesting
(while_statement) @nesting
(do_while_statement) @nesting
(try_expression) @nesting
(lambda_literal) @nesting
