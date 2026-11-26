import { Fragment } from 'react';
import { Text, View } from 'react-native';
import { ui } from './ui_styles';

/** Renders the journal's light Markdown: **bold**, *italic*, "- " bullets and "1. " numbered lines. */
export function LightMarkdown({ source, numberOfLines }: { readonly source: string; readonly numberOfLines?: number }) {
  const lines = source.split('\n');
  if (numberOfLines !== undefined) {
    return (
      <Text style={ui.text} numberOfLines={numberOfLines}>
        {renderInline(lines.join(' '))}
      </Text>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, index) => {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={index} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={ui.text}>•</Text>
              <Text style={[ui.text, { flex: 1 }]}>{renderInline(bullet[1] ?? '')}</Text>
            </View>
          );
        }
        if (numbered) {
          return (
            <View key={index} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={ui.text}>{numbered[1]}.</Text>
              <Text style={[ui.text, { flex: 1 }]}>{renderInline(numbered[2] ?? '')}</Text>
            </View>
          );
        }
        return (
          <Text key={index} style={ui.text}>
            {line === '' ? ' ' : renderInline(line)}
          </Text>
        );
      })}
    </View>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <Text key={index} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>;
    if (/^\*[^*].*\*$/.test(part)) return <Text key={index} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
