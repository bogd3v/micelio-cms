import { Alert, Box, Button, Field, Flex, SingleSelect, SingleSelectOption, TextInput, Typography } from '@strapi/design-system';
import { useFetchClient, useForm } from '@strapi/strapi/admin';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

interface ThemeChoice {
  id: string;
  version: string;
  digest: string;
  contract: string;
  origin: 'official' | 'community';
  code: boolean;
  report: string | null;
  available: boolean;
  unavailableReason: 'not-in-image' | null;
}

interface PickerModel {
  indexAvailable: boolean;
  themes: ThemeChoice[];
  update: { version: string; digest: string } | null;
  status: { active: { id: string; version: string } | null; lastError: string | null } | null;
}

interface ThemePickerProps {
  name: string;
  value?: string | null;
  disabled?: boolean;
  error?: string;
  hint?: string;
  required?: boolean;
  onChange: (event: { target: { name: string; value: string | null; type: string } }) => void;
}

const DEFAULT_VALUE = '__default__';

/**
 * The input of `site.theme.themeId` (custom field `global::theme-picker`): lists the registry's
 * themes, writes the id, the exact version and the digest together, offers an update only as a
 * button, and falls back to a text input when the registry cannot be read.
 */
export default function ThemePicker({ name, value, disabled, error, hint, required, onChange }: ThemePickerProps) {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const setField = useForm('ThemePicker', (state) => state.onChange);
  const prefix = name.slice(0, name.lastIndexOf('.') + 1);
  const pinnedVersion = useForm('ThemePicker', (state) => (state.values as Record<string, Record<string, string | null> | undefined>)[prefix.slice(0, -1)]?.themeVersion ?? null);
  const [model, setModel] = useState<PickerModel | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (value) query.set('id', value);
    if (value && pinnedVersion) query.set('version', pinnedVersion);
    let cancelled = false;
    const load = async () => {
      try {
        const response = await get<{ data: PickerModel }>(`/theme-picker/themes?${query.toString()}`);
        if (!cancelled) setModel(response.data.data);
      } catch {
        // The registry or the route failed: the field falls back to free text.
        if (!cancelled) setModel({ indexAvailable: false, themes: [], update: null, status: null });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [get, value, pinnedVersion]);

  const write = (id: string | null, version: string | null, digest: string | null) => {
    onChange({ target: { name, value: id, type: 'string' } });
    setField(`${prefix}themeVersion`, version);
    setField(`${prefix}themeDigest`, digest);
  };
  const label = formatMessage({ id: 'micelio.themePicker.label', defaultMessage: 'Theme' });

  if (!model) {
    return <Typography textColor="neutral600">{formatMessage({ id: 'micelio.themePicker.loading', defaultMessage: 'Loading the registry…' })}</Typography>;
  }

  if (!model.indexAvailable) {
    return (
      <Field.Root name={name} error={error} hint={hint} required={required}>
        <Field.Label>{label}</Field.Label>
        <TextInput
          name={name}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event: { target: { value: string } }) => onChange({ target: { name, value: event.target.value || null, type: 'string' } })}
        />
        <Field.Hint />
        <Typography variant="pi" textColor="neutral600">
          {formatMessage({ id: 'micelio.themePicker.offline', defaultMessage: 'The theme registry could not be read. Type the theme id by hand; the version and digest below stay as they are.' })}
        </Typography>
        <Field.Error />
      </Field.Root>
    );
  }

  const selected = model.themes.find((theme) => theme.id === value);
  const pick = (id: string) => {
    const choice = model.themes.find((theme) => theme.id === id);
    if (choice) write(choice.id, choice.version, choice.digest);
    else write(null, null, null);
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Field.Root name={name} error={error} hint={hint} required={required}>
        <Field.Label>{label}</Field.Label>
        <SingleSelect name={name} value={value || DEFAULT_VALUE} disabled={disabled} onChange={(next: string | number) => pick(next === DEFAULT_VALUE ? '' : String(next))}>
          <SingleSelectOption value={DEFAULT_VALUE}>{formatMessage({ id: 'micelio.themePicker.default', defaultMessage: "The instance's default theme" })}</SingleSelectOption>
          {model.themes.map((theme) => (
            <SingleSelectOption key={theme.id} value={theme.id} disabled={!theme.available}>
              {theme.id} {theme.version}
              {theme.available ? '' : ` (${formatMessage({ id: 'micelio.themePicker.unavailable', defaultMessage: 'unavailable' })})`}
            </SingleSelectOption>
          ))}
        </SingleSelect>
        <Field.Hint />
        <Field.Error />
      </Field.Root>
      {selected && (
        <Box>
          <Typography variant="pi" textColor="neutral600">
            {formatMessage({ id: `micelio.themePicker.${selected.origin}`, defaultMessage: selected.origin })}
            {' · '}
            {formatMessage({ id: 'micelio.themePicker.details', defaultMessage: 'Version {version}, contract {contract}' }, { version: pinnedVersion ?? selected.version, contract: selected.contract })}
            {selected.code ? ` · ${formatMessage({ id: 'micelio.themePicker.code', defaultMessage: 'Ships code' })}` : ''}
          </Typography>
          {selected.report && (
            <Typography variant="pi" textColor="neutral600" display="block">
              {formatMessage({ id: 'micelio.themePicker.report', defaultMessage: 'Admission report: {report}' }, { report: selected.report })}
            </Typography>
          )}
        </Box>
      )}
      {model.themes.filter((theme) => !theme.available).map((theme) => (
        <Typography key={theme.id} variant="pi" textColor="danger600">
          {theme.id}: {formatMessage({ id: 'micelio.themePicker.notInImage', defaultMessage: 'This image was not built with this theme, which ships code' })}
        </Typography>
      ))}
      {model.update && (
        <Alert variant="default" closeLabel="" onClose={undefined} action={
          <Button variant="secondary" size="S" disabled={disabled} onClick={() => write(value ?? null, model.update!.version, model.update!.digest)}>
            {formatMessage({ id: 'micelio.themePicker.updateAction', defaultMessage: 'Move to {version}' }, { version: model.update.version })}
          </Button>
        }>
          {formatMessage({ id: 'micelio.themePicker.update', defaultMessage: 'Version {version} is available.' }, { version: model.update.version })}
        </Alert>
      )}
      {model.status && (
        <Box>
          <Typography variant="pi" textColor="neutral600" display="block">
            {model.status.active
              ? formatMessage({ id: 'micelio.themePicker.active', defaultMessage: 'Active on the frontend: {theme}' }, { theme: `${model.status.active.id} ${model.status.active.version}` })
              : formatMessage({ id: 'micelio.themePicker.noneActive', defaultMessage: 'Active on the frontend: not reported' })}
          </Typography>
          {model.status.lastError && (
            <Typography variant="pi" textColor="danger600" display="block">
              {formatMessage({ id: 'micelio.themePicker.lastError', defaultMessage: 'Last error: {error}' }, { error: model.status.lastError })}
            </Typography>
          )}
        </Box>
      )}
    </Flex>
  );
}
