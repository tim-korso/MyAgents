export function appendCronPromptToDraft(currentValue: string, cronPrompt: string): string {
  const prompt = cronPrompt.trim();
  if (!prompt) return currentValue;
  if (!currentValue.trim()) return prompt;
  return `${currentValue.replace(/\s+$/, '')}\n\n${prompt}`;
}
