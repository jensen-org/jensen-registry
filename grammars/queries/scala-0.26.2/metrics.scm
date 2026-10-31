(function_definition) @function
(lambda_expression) @function
(parameter) @parameter
(if_expression) @branch
(case_clause) @branch
(catch_clause) @branch
(for_expression) @loop
(while_expression) @loop
(infix_expression operator: (operator_identifier) @_op (#any-of? @_op "&&" "||")) @boolean
(if_expression) @nesting
(match_expression) @nesting
(for_expression) @nesting
(while_expression) @nesting
