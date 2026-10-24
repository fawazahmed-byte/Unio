import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatBudget, relativeDeadline } from '../../lib/format.js';
import { endpoints } from '../../services/api.js';
import { StatusPill } from '../ui/Badge.jsx';
import { Button, ButtonLink } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { Alert, EmptyState, ErrorState, Skeleton } from '../ui/Feedback.jsx';
import { Textarea } from '../ui/Form.jsx';
import { ApiErrorMessage } from '../verification/BrandTrust.jsx';

/**
 * Brand invites a creator to one of its own open campaigns.
 * Ownership, open status and duplicate checks are enforced by the API.
 */
export function InviteDialog({ open, onClose, creator, existingInvitations = [] }) {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(null);

  const campaigns = useQuery({
    queryKey: ['mine', 'brand-campaigns', 'open'],
    queryFn: () => endpoints.brand.campaigns({ status: 'open', limit: 50 }),
    enabled: open,
  });

  const invite = useMutation({
    mutationFn: () => endpoints.brand.invite(campaignId, { creatorId: creator._id, message: message.trim() }),
    onSuccess: (data) => {
      setSent(data);
      qc.invalidateQueries({ queryKey: ['mine'] });
      qc.invalidateQueries({ queryKey: ['pub', 'creator', creator._id] });
    },
  });

  const statusFor = (id) => existingInvitations.find((i) => String(i.campaignId) === String(id))?.status;
  const blocked = (id) => ['pending', 'accepted'].includes(statusFor(id));
  const selected = campaigns.data?.items.find((c) => c._id === campaignId);
  const returnHere = `/creators/${creator._id}?intent=invite`;

  const close = () => {
    setSent(null);
    setCampaignId('');
    setMessage('');
    invite.reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title={`Invite ${creator.displayName}`} description="Choose one of your open campaigns and add a short note.">
      {sent ? (
        <div className="space-y-5 py-2">
          <CheckCircle2 className="size-8 text-navy" strokeWidth={1.5} />
          <div>
            <h3 className="text-2xl">Invitation sent</h3>
            <p className="mt-2 text-[15px] text-steel">
              {creator.displayName} can now accept or decline your invitation to <span className="text-ink">{selected?.title}</span>. You’ll see their
              answer in your invitations list.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/brand/invitations">View invitations</ButtonLink>
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : campaigns.error ? (
        <ErrorState error={campaigns.error} onRetry={campaigns.refetch} />
      ) : !campaigns.data ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : campaigns.data.items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="You don’t have an open campaign yet"
          action={
            <ButtonLink to={`/brand/campaigns/new?returnTo=${encodeURIComponent(returnHere)}`}>Create a campaign</ButtonLink>
          }
        >
          Invitations are linked to a campaign so the creator knows the brief, budget and deadline. Create one, then come back here.
        </EmptyState>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (campaignId) invite.mutate();
          }}
          className="space-y-6"
        >
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold">Campaign</legend>
            <div className="space-y-2">
              {campaigns.data.items.map((c) => {
                const status = statusFor(c._id);
                const disabled = blocked(c._id);
                return (
                  <label
                    key={c._id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors ${
                      campaignId === c._id ? 'border-navy bg-soft/60' : 'border-line bg-white hover:border-navy/50'
                    } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="campaign"
                      value={c._id}
                      checked={campaignId === c._id}
                      onChange={() => setCampaignId(c._id)}
                      disabled={disabled}
                      className="mt-1 accent-navy"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.title}</span>
                      <span className="block text-[13px] text-steel">
                        {formatBudget(c.budgetMin, c.budgetMax)} · {relativeDeadline(c.deadline)}
                      </span>
                    </span>
                    {status && <StatusPill status={status} />}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[13px] text-steel">
              Need a different brief?{' '}
              <Link to={`/brand/campaigns/new?returnTo=${encodeURIComponent(returnHere)}`} className="text-navy underline-offset-4 hover:underline">
                Create a new campaign
              </Link>
            </p>
          </fieldset>

          <Textarea
            label="Message (optional)"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Tell ${creator.displayName.split(' ')[0]} why their work fits this brief.`}
          />

          {invite.error && (
            <Alert tone="error">
              <ApiErrorMessage error={invite.error} />
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-line/60 pt-5 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!campaignId} loading={invite.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
