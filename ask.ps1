param(
    [Parameter(Mandatory=$true)]
    [string]$Prompt
)

$body = @{
    model = "gpt-6-astra"
    messages = @(
        @{
            role = "user"
            content = $Prompt
        }
    )
    max_tokens = 2000
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod `
    -Uri "https://api.experientiallabs.ai/v1/chat/completions" `
    -Method Post `
    -Headers @{
        "Authorization" = "Bearer $env:EXPLABS_API_KEY"
        "Content-Type" = "application/json"
    } `
    -Body $body

$response.choices[0].message.content