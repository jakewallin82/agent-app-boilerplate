interface JsonViewerProps {
  content: string;
}

export function JsonViewer({ content }: JsonViewerProps) {
  let formattedJson: string;
  let parseError: string | null = null;

  try {
    const parsed = JSON.parse(content);
    formattedJson = JSON.stringify(parsed, null, 2);
  } catch (e) {
    parseError = 'Invalid JSON';
    formattedJson = content;
  }

  if (parseError) {
    return (
      <div>
        <div className="text-red-400 text-sm mb-2">{parseError}</div>
        <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
          {content}
        </pre>
      </div>
    );
  }

  // Simple syntax highlighting
  const highlightedJson = formattedJson
    .split('\n')
    .map((line, i) => (
      <div key={i} className="hover:bg-muted/50">
        {highlightLine(line)}
      </div>
    ));

  return (
    <pre className="text-sm font-mono">
      {highlightedJson}
    </pre>
  );
}

function highlightLine(line: string): JSX.Element {
  // Match different JSON parts
  const parts: JSX.Element[] = [];
  let remaining = line;
  let keyIndex = 0;

  // Match key: "value" patterns
  const keyValueMatch = remaining.match(/^(\s*)(".*?")(\s*:\s*)/);
  if (keyValueMatch) {
    parts.push(
      <span key={`ws-${keyIndex++}`}>{keyValueMatch[1]}</span>,
      <span key={`key-${keyIndex++}`} className="text-blue-400">{keyValueMatch[2]}</span>,
      <span key={`colon-${keyIndex++}`}>{keyValueMatch[3]}</span>
    );
    remaining = remaining.slice(keyValueMatch[0].length);
  }

  // Match string values
  const stringMatch = remaining.match(/^(".*?")(.*)$/);
  if (stringMatch) {
    parts.push(
      <span key={`str-${keyIndex++}`} className="text-green-400">{stringMatch[1]}</span>,
      <span key={`rest-${keyIndex++}`}>{stringMatch[2]}</span>
    );
    remaining = '';
  }

  // Match numbers
  const numberMatch = remaining.match(/^(-?\d+\.?\d*)(.*)/);
  if (numberMatch) {
    parts.push(
      <span key={`num-${keyIndex++}`} className="text-yellow-400">{numberMatch[1]}</span>,
      <span key={`rest-${keyIndex++}`}>{numberMatch[2]}</span>
    );
    remaining = '';
  }

  // Match booleans and null
  const boolNullMatch = remaining.match(/^(true|false|null)(.*)/);
  if (boolNullMatch) {
    parts.push(
      <span key={`bool-${keyIndex++}`} className="text-purple-400">{boolNullMatch[1]}</span>,
      <span key={`rest-${keyIndex++}`}>{boolNullMatch[2]}</span>
    );
    remaining = '';
  }

  // Add any remaining text
  if (remaining) {
    parts.push(<span key={`rem-${keyIndex++}`}>{remaining}</span>);
  }

  return <>{parts.length > 0 ? parts : line}</>;
}
