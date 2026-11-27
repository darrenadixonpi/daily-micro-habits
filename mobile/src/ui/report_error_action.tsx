import { useState } from 'react';
import { Text } from 'react-native';
import { excludeContentItem } from '../content/content_repository';
import { useAppState } from './app_state_context';
import { ConfirmActionButton } from './controls';
import { ui } from './ui_styles';

/**
 * Report error (spec Section 6): excludes the item from future serving, suspends its review
 * cards and logs the reason. Today's task gets a replacement item on the next refresh.
 */
export function ReportErrorAction({ itemId, moduleLabel, testID }: { readonly itemId: string; readonly moduleLabel: string; readonly testID?: string }) {
  const { database, refreshDaily } = useAppState();
  const [message, setMessage] = useState<string | null>(null);
  if (!database) return null;
  return (
    <>
      <ConfirmActionButton
        testID={testID}
        tone="muted"
        label="Report an error in this item"
        confirmLabel="Report and replace"
        consequence={`This ${moduleLabel} item will not be shown again and its review cards are suspended.`}
        onConfirm={() => {
          const result = excludeContentItem(database.executor, itemId, `Reported from ${moduleLabel} on ${new Date().toISOString()}`);
          setMessage(`Reported. ${result.cardsSuspended} review card${result.cardsSuspended === 1 ? '' : 's'} suspended.`);
          void refreshDaily();
        }}
      />
      {message ? <Text style={[ui.muted, { textAlign: 'center' }]}>{message}</Text> : null}
    </>
  );
}

/** Small "Generated" label for items written by the generation pipeline. */
export function GeneratedBadge({ source }: { readonly source: string }) {
  if (source === 'bundled') return null;
  return <Text style={[ui.muted, { fontStyle: 'italic' }]}>{source === 'wikimedia' ? 'From Wikipedia' : 'Generated'}</Text>;
}
