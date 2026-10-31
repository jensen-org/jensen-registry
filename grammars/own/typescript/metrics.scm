(function_declaration) @function
(generator_function_declaration) @function
(function_expression) @function
(arrow_function) @function
(method_definition) @function
(arrow_function parameter: (identifier) @parameter)
(if_statement) @branch
(switch_case) @branch
(catch_clause) @branch
(ternary_expression) @branch
(for_statement) @loop
(for_in_statement) @loop
(while_statement) @loop
(do_statement) @loop
(binary_expression operator: ["&&" "||" "??"]) @boolean
(if_statement) @nesting
(switch_statement) @nesting
(catch_clause) @nesting
(ternary_expression) @nesting
(for_statement) @nesting
(for_in_statement) @nesting
(while_statement) @nesting
(do_statement) @nesting
(formal_parameters [(required_parameter) (optional_parameter)] @parameter)
