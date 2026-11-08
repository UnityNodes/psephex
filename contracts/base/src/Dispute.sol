// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient} from "./IAiOracle.sol";

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

    mapping(uint256 => Case) private _cases;

    error ZeroAddress();
    error ZeroTimeout();
    error NoStake();
    error OnlyOracle();
    error UnknownDispute(uint256 id);
    error AlreadySettled(uint256 id);
    error TooEarly(uint256 id, uint64 deadline);
    error PayoutFailed(address to, uint256 amount);

    event DisputeOpened(
        uint256 indexed id, address indexed claimant, address indexed counterparty, uint256 amount, string question
    );
    event Settled(uint256 indexed id, address indexed winner, uint256 amount);
    event Escalated(uint256 indexed id);
    event Refunded(uint256 indexed id, address indexed claimant, uint256 amount);

    constructor(address oracle_, uint64 timeout_) {
        if (oracle_ == address(0)) revert ZeroAddress();
        if (timeout_ == 0) revert ZeroTimeout();
        oracle = IAiOracle(oracle_);
        timeout = timeout_;
    }

    function openDispute(string calldata question, address counterparty) external payable returns (uint256 id) {
        if (msg.value == 0) revert NoStake();
        if (counterparty == address(0)) revert ZeroAddress();
        id = oracle.ask(question);
        _cases[id] = Case({
            claimant: msg.sender,
            counterparty: counterparty,
            amount: msg.value,
            deadline: uint64(block.timestamp) + timeout,
            escalated: false,
            settled: false
        });
        emit DisputeOpened(id, msg.sender, counterparty, msg.value, question);
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
