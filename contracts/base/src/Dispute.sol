// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient, MAX_QUESTION_BYTES} from "./IAiOracle.sol";

contract Dispute is IAiOracleClient {
    struct Case {
        address claimant;
        address counterparty;
        uint256 amount;
        uint64 deadline;
        bool escalated;
        bool settled;
    }

    IAiOracle public immutable oracle;
    uint64 public immutable timeout;
    uint256 public immutable minStake;

    mapping(uint256 => Case) private _cases;

    error ZeroAddress();
    error ZeroTimeout();
    error NoStake();
    error OnlyOracle();
    error UnknownDispute(uint256 id);
    error AlreadySettled(uint256 id);
    error TooEarly(uint256 id, uint64 deadline);
    error PayoutFailed(address to, uint256 amount);
    error InsufficientFee(uint256 required, uint256 provided);
    error FeeAboveMax(uint256 fee, uint256 maxFee);
    error StakeTooLow(uint256 stake, uint256 minStake);
    error QuestionTooLong(uint256 length, uint256 max);
    error RequestIdMismatch(uint256 expected, uint256 actual);

    event DisputeOpened(
        uint256 indexed id,
        address indexed claimant,
        address indexed counterparty,
        uint256 amount,
        uint256 fee,
        string question
    );
    event Settled(uint256 indexed id, address indexed winner, uint256 amount);
    event Escalated(uint256 indexed id);
    event Refunded(uint256 indexed id, address indexed claimant, uint256 amount);

    constructor(address oracle_, uint64 timeout_, uint256 minStake_) {
        if (oracle_ == address(0)) revert ZeroAddress();
        if (timeout_ == 0) revert ZeroTimeout();
        oracle = IAiOracle(oracle_);
        timeout = timeout_;
        minStake = minStake_;
    }

    function openDispute(string calldata question, address counterparty, uint256 maxFee)
        external
        payable
        returns (uint256 id)
    {
        if (counterparty == address(0)) revert ZeroAddress();
        uint256 length = bytes(question).length;
        if (length > MAX_QUESTION_BYTES) revert QuestionTooLong(length, MAX_QUESTION_BYTES);
        uint256 fee = oracle.fee();
        if (fee > maxFee) revert FeeAboveMax(fee, maxFee);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        uint256 stake = msg.value - fee;
        if (stake == 0) revert NoStake();
        if (stake < minStake) revert StakeTooLow(stake, minStake);

        uint256 expectedId = oracle.lastId() + 1;
        _cases[expectedId] = Case({
            claimant: msg.sender,
            counterparty: counterparty,
            amount: stake,
            deadline: uint64(block.timestamp) + timeout,
            escalated: false,
            settled: false
        });

        id = oracle.ask{value: fee}(question);
        if (id != expectedId) revert RequestIdMismatch(expectedId, id);
        emit DisputeOpened(id, msg.sender, counterparty, stake, fee, question);
    }

    function onAnswer(uint256 id, uint8 answer) external {
        if (msg.sender != address(oracle)) revert OnlyOracle();
        Case storage c = _cases[id];
        if (c.claimant == address(0)) revert UnknownDispute(id);
        if (c.settled) revert AlreadySettled(id);

        address winner;
        if (answer == uint8(IAiOracle.Answer.YES)) {
            winner = c.claimant;
        } else if (answer == uint8(IAiOracle.Answer.NO)) {
            winner = c.counterparty;
        } else {
            c.escalated = true;
            emit Escalated(id);
            return;
        }

        c.settled = true;
        uint256 amount = c.amount;
        (bool ok,) = winner.call{value: amount}("");
        if (!ok) revert PayoutFailed(winner, amount);
        emit Settled(id, winner, amount);
    }

    function refund(uint256 id) external {
        Case storage c = _cases[id];
        if (c.claimant == address(0)) revert UnknownDispute(id);
        if (c.settled) revert AlreadySettled(id);
        if (!c.escalated && block.timestamp < c.deadline) revert TooEarly(id, c.deadline);

        c.settled = true;
        address claimant = c.claimant;
        uint256 amount = c.amount;
        (bool ok,) = claimant.call{value: amount}("");
        if (!ok) revert PayoutFailed(claimant, amount);
        emit Refunded(id, claimant, amount);
    }

    function getCase(uint256 id) external view returns (Case memory) {
        return _cases[id];
    }
}
