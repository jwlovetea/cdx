import { describe, expect, it, vi } from 'vitest';
import { Uri, commands } from './__mocks__/vscode';
import { openConvertedParquet } from '../openDataset';

vi.mock('@posit-dev/positron', () => ({
  inPositron: vi.fn(() => true)
}));

describe('opening a converted Parquet', () => {
  it('uses vscode.open so Positron routes *.parquet into its built-in Data Explorer', async () => {
    const spy = vi.spyOn(commands, 'executeCommand').mockResolvedValue(undefined);

    await openConvertedParquet(Uri.file('/tmp/example.parquet'));

    expect(spy).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ path: '/tmp/example.parquet', scheme: 'file' }),
      { preview: false }
    );
  });

  it('rewrites vscode-userdata cache URIs to file:// before opening', async () => {
    const spy = vi.spyOn(commands, 'executeCommand').mockResolvedValue(undefined);
    const userdata = Uri.file('/tmp/example.parquet').with({ scheme: 'vscode-userdata' });

    await openConvertedParquet(userdata);

    expect(spy).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ path: '/tmp/example.parquet', scheme: 'file' }),
      { preview: false }
    );
  });
});
