const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
const { notifySupportEvent, resolveUserRecipient } = require('../utils/supportNotifications');
const { createActivityEntry, appendActivity, syncSlaFields } = require('../utils/supportWorkflow');

const ensureTicketAccess = async ({ ticketId, userId, role }) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError('Ticket not found', 404);

  if (role === 'admin') return ticket;
  if (String(ticket.userId) !== String(userId)) throw new AppError('Forbidden', 403);
  return ticket;
};

const listComments = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    await ensureTicketAccess({ ticketId, userId: req.auth.userId, role: req.auth.role });

    const comments = await TicketComment.find({ ticketId }).sort({ createdAt: 1 });

    const visibleComments = req.auth.role === 'admin' ? comments : comments.filter((c) => !c.isInternal);

    return sendSuccess(res, { data: visibleComments });
  } catch (err) {
    return next(err);
  }
};

const addComment = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { body, isInternal } = req.body;

    const ticket = await ensureTicketAccess({ ticketId, userId: req.auth.userId, role: req.auth.role });

    const comment = await TicketComment.create({
      ticketId,
      userId: req.auth.userId,
      body,
      isInternal: req.auth.role === 'admin' ? Boolean(isInternal) : false,
    });

    if (!comment.isInternal) {
      if (!ticket.firstResponseAt && req.auth.role === 'admin') {
        ticket.firstResponseAt = new Date();
      }
      if (req.auth.role === 'admin' && ['new', 'assigned'].includes(ticket.status)) {
        ticket.status = 'in_progress';
      }

      appendActivity(
        ticket,
        createActivityEntry({
          type: 'comment_added',
          actorUserId: req.auth.userId,
          actorRole: req.auth.role,
          status: ticket.status,
          message: req.auth.role === 'admin' ? 'Support reply added' : 'Customer reply added',
          meta: { commentId: comment._id },
        }),
      );
      syncSlaFields(ticket);
      await ticket.save();

      if (req.auth.role === 'admin') {
        const owner = await resolveUserRecipient(ticket.userId);
        await notifySupportEvent({
          moduleKey: 'ticket',
          eventKey: 'comment_added',
          recordId: ticket._id,
          email: owner?.email,
          mobile: owner?.mobile,
          subject: `Reply on ticket: ${ticket.subject}`,
          body: `A new reply has been added to your ticket "${ticket.subject}".`,
        });
      } else {
        const assignee = await resolveUserRecipient(ticket.assignedTo);
        await notifySupportEvent({
          moduleKey: 'ticket',
          eventKey: 'comment_added',
          recordId: ticket._id,
          email: assignee?.email,
          mobile: assignee?.mobile,
          subject: `Customer replied: ${ticket.subject}`,
          body: `The customer has replied on ticket "${ticket.subject}".`,
        });
      }
    }

    return sendSuccess(res, { statusCode: 201, message: 'Comment added', data: comment });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listComments, addComment };
