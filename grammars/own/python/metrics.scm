(function_definition) @function
(lambda) @function
(parameters [(identifier) (typed_parameter) (default_parameter) (typed_default_parameter) (list_splat_pattern) (dictionary_splat_pattern)] @parameter)
(lambda_parameters [(identifier) (default_parameter) (list_splat_pattern) (dictionary_splat_pattern)] @parameter)
(if_statement) @branch
(elif_clause) @branch
(except_clause) @branch
(case_clause) @branch
(conditional_expression) @branch
(for_statement) @loop
(while_statement) @loop
(for_in_clause) @loop
(boolean_operator) @boolean
(if_statement) @nesting
(for_statement) @nesting
(while_statement) @nesting
(try_statement) @nesting
(match_statement) @nesting
(with_statement) @nesting
